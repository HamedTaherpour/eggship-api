import { ApiProperty } from '@nestjs/swagger';

export class AsyncFailureResponseDto {
  @ApiProperty() data!: unknown;
}
export class AsyncFailureListResponseDto {
  @ApiProperty({ type: [AsyncFailureResponseDto] }) data!: unknown[];
  @ApiProperty() meta!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
