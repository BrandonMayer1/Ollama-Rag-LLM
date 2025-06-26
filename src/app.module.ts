import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpModule } from '@nestjs/axios';
import { FileUploadService } from './file-upload.service';

@Module({
  imports: [HttpModule],
  controllers: [AppController],
  providers: [AppService, FileUploadService],
})
export class AppModule {}
