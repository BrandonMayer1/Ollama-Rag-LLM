import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FileUploadService } from './file-upload.service';

@Injectable()


export class AppService {
  constructor(private readonly httpService: HttpService, private readonly fileUploadService: FileUploadService) {}
  private chatHistory: Array<{role: string, content: string}> = [];

  async startChat(message: string){
    console.log("RECIEVED MESSAGE: " + message);

    // Get relevant context from vector database
    const context = await this.fileUploadService.queryWithMessage(message);
    console.log("RETRIEVED CONTEXT: ", context);

    this.chatHistory.push({
      role: 'user',
      content: `You are an AI assistant:${message}. Here are some documents to reference in case you will need them: ${context}`,
    });

    const payload = {
      model: "deepseek-v2:latest",
      messages: this.chatHistory,
      "stream": false,
    };


    try {
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:11434/api/chat', payload, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      const aiMessage = response.data.message;
      this.chatHistory.push(aiMessage);
      console.log("AI RESPONDED: " + aiMessage.content);
      return aiMessage.content;
    }
    catch (error){
      console.log("ERROR: " + error.message);
      throw error;
    }
  }
}
