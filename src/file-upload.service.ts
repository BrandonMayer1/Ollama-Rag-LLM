import { Injectable } from '@nestjs/common';
import { OllamaEmbeddings } from '@langchain/ollama';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from 'langchain/document';
import { ChromaClient } from 'chromadb';

@Injectable()
export class FileUploadService {
  private embeddings: OllamaEmbeddings;
  private client: ChromaClient;

  constructor() {
    this.client = new ChromaClient();
    this.embeddings = new OllamaEmbeddings({
      model: 'mxbai-embed-large',
      baseUrl: 'http://localhost:11434',
    });
  }

  async handleFileUpload(file: Express.Multer.File) {
    try {
      if (!file || !file.buffer) {
        throw new Error('No file or file buffer received');
      }
      const content = file.buffer.toString('utf-8');
      const documentName = file.originalname;
      console.log(`Uploading file: ${documentName}`);
      const mDocs = await this.headerChunking(content);
      for (const doc of mDocs) {
        const vector = await this.toVector(doc.pageContent);
        await this.storeInChroma(vector, doc.pageContent, documentName);
      }
      console.log(`File upload and processing complete: ${documentName}`);
    } catch (error) {
      console.error(`Error reading file: ${error.message}`);
      throw new Error(`Error reading file: ${error.message}`);
    }
  }

  //---------------------------------------MARKDOWN METHOD------------------------------------------------
  // SPLITS BASED ON MARKDOWN HEADERS BEST FOR RETRIEVAL OF REFERENCES
  async headerChunking(text: string): Promise<Document[]> {
    const separators = [
      '\n# ', '\n## ', // Major section breaks
      '```\n', // Code blocks
      '\n- ', '\n* ', '\n1. ', '\n| ', // Lists/tables
      '\n### ', '\n#### ', // Subsections
      '\n<', '\n</', // HTML components
      '\n---\n', '\n***\n', // Horizontal rules
      '\n\n', '\n', ' ' // Soft breaks
    ];

    const len = text.length;
    let chunkSize = 250;
    if (len > 2500) {
      chunkSize = 250 + Math.floor((len - 2500) / 2500) * 200;
    }
    if (chunkSize > 1000) {
      chunkSize = 1000;
    }

    // Based on Markdown Document Separators
    const headerSplitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
      chunkSize: chunkSize,
      chunkOverlap: 50,
      keepSeparator: true,
      separators: separators,
    }); // Potentially Change these parameters
    return await headerSplitter.createDocuments([text]);
  }

  async toVector(message: string): Promise<number[]> {
    return this.embeddings.embedQuery(message);
  }

  async storeInChroma(embedding: number[], text: string, documentName: string) {
    try {
      const collection = await this.client.getOrCreateCollection({ 
        name: 'pdf-store',
        embeddingFunction: {
          generate: async (texts: string[]): Promise<number[][]> => {
            const embeddings: number[][] = [];
            for (const text of texts) {
              const embedding = await this.toVector(text);
              embeddings.push(embedding);
            }
            return embeddings;
          }
        }
      });
      await collection.upsert({
        ids: [documentName],
        embeddings: [embedding],
        documents: [text],
      });
      console.log(`Stored document '${documentName}' in ChromaDB.`);
    } catch (error) {
      console.error('Error storing in ChromaDB:', error);
    }
  }

  //--------------------------RETRIEVAL-----------------------------------------
  async queryWithMessage(message: string) {
    const collection = await this.client.getOrCreateCollection({
      name: 'pdf-store',
      embeddingFunction: {
        generate: async (texts: string[]): Promise<number[][]> => {
          const embeddings: number[][] = [];
          for (const text of texts) {
            const embedding = await this.toVector(text);
            embeddings.push(embedding);
          }
          return embeddings;
        }
      }
    });
    console.log('Querying vector database with message.');

    const vectorQuery = await this.toVector(message);

    // Find best document
    const bestDocIds = await this.findTopDocument(vectorQuery);
    if (!bestDocIds || !bestDocIds[0]) {
      console.log('No relevant documents found for query.');
      return '';
    }
    // Get the best chunks from document
    const results = await collection.query({
      queryEmbeddings: [vectorQuery],
      ids: bestDocIds,
      nResults: 5,
      include: ['documents'],
    });

    const ids = results.ids?.[0] || [];
    const docs = results.documents?.[0] || [];

    const resultsArray: { documentName: string; documentContent: string | null }[] = [];
    for (let i = 0; i < ids.length; i++) {
      resultsArray.push({
        documentName: ids[i],
        documentContent: docs[i],
      });
    }
    console.log('RAG document retrieval complete.');
    return resultsArray;
  }

  // Finds the best document from 10 chunks
  // Weighs them based on Average Similarity
  // Returns the best one or multiple if there are more than 1 with a close .1 similarity
  async findTopDocument(query: number[]) {
    const collection = await this.client.getOrCreateCollection({ 
      name: 'pdf-store',
      embeddingFunction: {
        generate: async (texts: string[]): Promise<number[][]> => {
          const embeddings: number[][] = [];
          for (const text of texts) {
            const embedding = await this.toVector(text);
            embeddings.push(embedding);
          }
          return embeddings;
        }
      }
    });
    const results = await collection.query({
      queryEmbeddings: [query],
      nResults: 10,
    });

    const ids = results.ids?.[0];
    const distances = results.distances?.[0];

    if (!ids || !distances) {
      return [];
    }

    const docDistanceSum: Record<string, number> = {};
    const docCount: Record<string, number> = {};
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const distance = distances[i];
      if (id != null && distance != null) {
        docDistanceSum[id] = (docDistanceSum[id] || 0) + distance;
        docCount[id] = (docCount[id] || 0) + 1;
      }
    }

    let topDoc: string | undefined = undefined;
    let lowestAvgDistance = Number.POSITIVE_INFINITY;
    let lowAverageDocs: string[] = [];
    for (const doc in docDistanceSum) {
      const avgDistance = docDistanceSum[doc] / docCount[doc];
      if (avgDistance < lowestAvgDistance) {
        lowestAvgDistance = avgDistance;
        topDoc = doc;
      }
    }
    // LOOKS FOR DOCS THAT HAVE A CLOSE AVERAGE TO THE CLOSEST ONE AND ADDS IT
    for (const doc in docDistanceSum) {
      const avgDistance = docDistanceSum[doc] / docCount[doc];
      if (Math.abs(avgDistance - lowestAvgDistance) <= 0.2) {
        lowAverageDocs.push(doc);
        // Only log doc id, not full content
        console.log(`Added document to nearTopDocs: ${doc}`);
      }
    }

    if (lowAverageDocs.length > 1) {
      console.log('Returning multiple top documents:', lowAverageDocs);
      return lowAverageDocs;
    }
    console.log('Returning top document:', topDoc);
    return [topDoc!];
  }
}

