import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryReconciliationIssueCode,
  InventoryReconciliationStatus,
  type InventoryReconciliationIssue,
  type InventoryReconciliationResult,
} from '../../domain/inventory-reconciliation';

class InventoryReconciliationBalanceDto {
  @ApiProperty()
  onHand!: number;

  @ApiProperty()
  reserved!: number;

  @ApiProperty({ description: 'Derived (`onHand - reserved`).' })
  available!: number;
}

class InventoryReconciliationExpectedDto {
  @ApiProperty({
    description: 'Sum of ACTIVE reservation row quantities.',
  })
  reservedFromReservations!: number;

  @ApiPropertyOptional({
    description:
      'On-hand reconstructed from ledger deltas; null when no ledger history.',
    nullable: true,
  })
  onHandFromLedger!: number | null;

  @ApiPropertyOptional({
    description:
      'Reserved reconstructed from ledger deltas; null when no ledger history.',
    nullable: true,
  })
  reservedFromLedger!: number | null;
}

class InventoryReconciliationIssueDto {
  @ApiProperty({ enum: InventoryReconciliationIssueCode })
  code!: (typeof InventoryReconciliationIssueCode)[keyof typeof InventoryReconciliationIssueCode];

  @ApiProperty({ description: 'Operator-safe display message.' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Structured diagnostic details safe for Admin display.',
    type: 'object',
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}

class InventoryReconciliationDataDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ enum: InventoryReconciliationStatus })
  status!: (typeof InventoryReconciliationStatus)[keyof typeof InventoryReconciliationStatus];

  @ApiProperty({ type: InventoryReconciliationBalanceDto })
  current!: InventoryReconciliationBalanceDto;

  @ApiProperty({ type: InventoryReconciliationExpectedDto })
  expected!: InventoryReconciliationExpectedDto;

  @ApiProperty({ type: [InventoryReconciliationIssueDto] })
  issues!: InventoryReconciliationIssueDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  checkedAt!: string;
}

export class AdminInventoryReconciliationResponseDto {
  @ApiProperty({ type: InventoryReconciliationDataDto })
  data!: InventoryReconciliationDataDto;
}

function toIssueDto(
  issue: InventoryReconciliationIssue,
): InventoryReconciliationIssueDto {
  return {
    code: issue.code,
    message: issue.message,
    ...(issue.details === undefined ? {} : { details: issue.details }),
  };
}

export function toAdminInventoryReconciliationDto(
  result: InventoryReconciliationResult,
): InventoryReconciliationDataDto {
  return {
    productId: result.productId,
    status: result.status,
    current: result.current,
    expected: result.expected,
    issues: result.issues.map(toIssueDto),
    checkedAt: result.checkedAt.toISOString(),
  };
}
