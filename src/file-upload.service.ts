import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';



@Injectable()
export class FileUploadService {
  private qdrant: QdrantClient;
  private embeddings: OllamaEmbeddings; 
  private textSplitter: RecursiveCharacterTextSplitter;


  constructor(private readonly httpService: HttpService) {
    this.qdrant = new QdrantClient({ url: 'http://localhost:6333' });
    this.embeddings = new OllamaEmbeddings({
      model: "mxbai-embed-large", 
      baseUrl: "http://localhost:11434", 
    });
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 100,         
      chunkOverlap: 20,        
      separators: ['\n\n', '\n', ' ', ''],  
    });
  }

  async handleFileUpload(file: Express.Multer.File): Promise<string> {
    console.log("RECIEVED FILE");
    const buffer = await fs.readFile(file.path);
    const data = await pdfParse(buffer);
    const chunks = await this.textSplitter.splitText(data.text);
    console.log(`\n=== ===\n`);
    for (let i = 0; i < chunks.length; i++) {
      console.log(`\n--- ---`);
      console.log(chunks[i]);
      console.log(`--- END CHUNK ${i + 1} ---\n`);
    }
    for (const chunk of chunks){
      let vector = await this.toVector(chunk);
      await this.storeInQdrant(vector, chunk);
    }
    
    return `Stored ${chunks.length} chunks in vector DB.`;
  }

  async toVector(message: string): Promise<number[]> {
    return this.embeddings.embedQuery(message);
}

  async storeInQdrant(embedding: number[], text: string) {
    const collections = await this.qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === 'pdf-storage');
    if (!exists){
        await this.qdrant.createCollection('pdf-storage', {
            vectors: {
            size: 1024, 
            distance: 'Cosine',
            },
        });
    }
    await this.qdrant.upsert('pdf-storage', {
        points: [{
            id: Date.now(), 
            vector: embedding,
            payload: { text },
            },
        ],
    });
    
  }

  //Method that turns the message into a vector then querys vector db
  async queryWithMessage(message: string){
    console.log("QUERYING WITH MESSAGE:", message);
    //message -> vector
    const vectorMessage = await this.toVector(message);
    //query VectorDB
    const result = await this.qdrant.search('pdf-storage', {
        vector: vectorMessage,
        limit: 5, 
        with_payload: true,
    });
    return result.map(hit => hit.payload?.text).filter(Boolean).join('\n\n');
  }
}






    /** 

    try {
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:11434/api/embed', payload, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      return response.data.embeddings?.[0]; //Check
    }
    catch (error){
      console.log("ERROR: " + error.message);
      throw error;
    }
  } */