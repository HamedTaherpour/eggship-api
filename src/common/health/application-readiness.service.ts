import { Injectable } from '@nestjs/common';

@Injectable()
export class ApplicationReadinessService {
  private acceptingTraffic = true;

  isAcceptingTraffic(): boolean {
    return this.acceptingTraffic;
  }

  stopAdmission(): void {
    this.acceptingTraffic = false;
  }
}
