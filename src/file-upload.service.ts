import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { QdrantClient } from '@qdrant/js-client-rest';

@Injectable()
export class FileUploadService {
  private qdrant: QdrantClient;

  constructor(private readonly httpService: HttpService) {
    this.qdrant = new QdrantClient({ url: 'http://localhost:6333' });
  }

  async handleFileUpload(file: Express.Multer.File): Promise<string> {
    console.log("RECIEVED FILE");
    const buffer = await fs.readFile(file.path);
    const data = await pdfParse(buffer);
    const chunks = this.simpleChunk(data.text.trim(), 100); 

    for (const chunk of chunks) {
      const embedding = await this.toVector(chunk);
      await this.storeInQdrant(embedding, chunk);
    }
  
    return `Stored ${chunks.length} chunks in vector DB.`;
  }

    private simpleChunk(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
    }
  

  async toVector(message: string): Promise<number[]> {
    const payload = {
      model: "mxbai-embed-large",
      input: message,
    };

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
