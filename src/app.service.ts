import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FileUploadService } from './file-upload.service';


@Injectable()
export class AppService {
  constructor(
    private readonly httpService: HttpService,
    private readonly fileUploadService: FileUploadService,
  ) {}
  private chatHistory: Array<{ role: string; content: string }> = [];

  async startChat(message: string) {
    console.log(`Received message for chat: ${message}`);
    const optimzedMessage = await this.OptimzedMessage(message);
    console.log(`Optimized search: ${optimzedMessage}`);

    // Get relevant context from vector database
    const context = await this.fileUploadService.queryWithMessage(optimzedMessage);

    const payload = {
      model: 'llama3.1',
      messages: [
        ...this.chatHistory,
        {
          role: 'system',
          content: `You're a helpful and intelligent RAG llm assistant that can answer questions. You have access to detailed documentation.
      
      When responding:
      - Reference documentation if needed.
      - Respond conversationally.
      - Be helpful.`,
        },
        {
          role: 'system',
          content: `Relevant documentation:\n${JSON.stringify(context)}`,
        },
        {
          role: 'user',
          content: `${message}`,
        },
        
      ],
      stream: false,
    };
    this.chatHistory.push({
      role: 'user',
      content: `${message}`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:11434/api/chat', payload, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      console.log('AI response received.');
      const aiMessage = response.data.message;
      this.chatHistory.push({ role: 'assistant', content: aiMessage.content });
      console.log(`[AI]: ${aiMessage.content}`);
      return aiMessage.content;
    } catch (error) {
      console.error('Error in startChat:', error.message);
      throw error;
    }
  }

  async OptimzedMessage(message: string): Promise<string> {
    // USE AI TO INFER TOPIC AND GET BUZZWORDS FOR VECTOR DB RETRIEVAL
    const topicMessage = [
      ...this.chatHistory,
      {
        role: 'user',
        content: `
You are an advanced AI assistant specialized in extracting optimal search terms from given messages. Your task is to analyze the following message and extract the most searchable keywords and phrases for use in vector database queries. Your output will be used directly in these queries, so precision and relevance are paramount.

Here is the message you need to analyze:

<message>
${message}
</message>

Instructions:
1. Carefully read and analyze the given message.
2. Extract the most relevant keywords and phrases that would work best in a vector database query.
3. Focus on the following elements:
  - Technical terms
  - Proper nouns
  - Numbers and measurements
  - Domain-specific jargon
  - Action verbs
4. Exclude the following!!!!!:
  - Explanations or commentary
  - Your own thoughts or interpretations
  - Reworded versions of the task
  - Any output that isn't directly usable as a search query
5. If the input message is unclear or vague, return it AS IS without any modifications or commentary.

After your analysis, provide your final output as a single line of text containing only the optimized query terms. Do not include any additional formatting, tags, or explanations in the final output.

Remember:
- Return ONLY optimized query terms in one line- no full sentences, no explanations, no filler text.
- If the input is unclear, return it unchanged without commentary.
- DO NOT ADD YOUR COMMENTARY ONLY OPTIMIZED WORDS FOR SEARCH
- Precision and relevance are crucial - each term in your output should significantly contribute to the query's effectiveness.
- I will you response exactly into the search so not additionaly commentary or notes.
- IMPORTANT RESPOND WITH ONE LINE ONLY OF KEYWORDS
`,
      },
    ];

    const topicPayload = {
      model: 'llama3.1',
      messages: topicMessage,
      stream: false,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:11434/api/chat', topicPayload, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      // Return only the first line of the response content
      return response.data.message.content.split('\n')[0];
    } catch (error) {
      console.error('Error in OptimzedMessage:', error.message);
      throw error;
    }
  }
}
