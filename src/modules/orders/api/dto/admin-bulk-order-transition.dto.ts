import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import {
  ADMIN_BULK_ORDER_TRANSITION_MAXIMUM,
  BulkOrderTransitionAction,
} from '../../application/bulk-order-transition.service';
import {
  AdminOrderDetailDto,
  toAdminOrderDetailDto,
} from './admin-order-response.dto';
import type { BulkOrderTransitionResult } from '../../application/bulk-order-transition.service';

export class AdminBulkOrderTransitionBodyDto {
  @ApiProperty({
    enum: [BulkOrderTransitionAction.SHIP, BulkOrderTransitionAction.DELIVER],
  })
  @IsIn([BulkOrderTransitionAction.SHIP, BulkOrderTransitionAction.DELIVER])
  action!: BulkOrderTransitionAction;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: ADMIN_BULK_ORDER_TRANSITION_MAXIMUM,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ADMIN_BULK_ORDER_TRANSITION_MAXIMUM)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderIds!: string[];
}

class AdminBulkOrderTransitionErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: Object }) details!: Record<string, unknown>;
}

class AdminBulkOrderTransitionSuccessDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ example: true }) success!: true;
  @ApiProperty() replay!: boolean;
  @ApiProperty({ type: AdminOrderDetailDto }) order!: AdminOrderDetailDto;
}

class AdminBulkOrderTransitionFailureDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ example: false }) success!: false;
  @ApiProperty({ type: AdminBulkOrderTransitionErrorDto })
  error!: AdminBulkOrderTransitionErrorDto;
}

class AdminBulkOrderTransitionSummaryDto {
  @ApiProperty() requested!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
}

class AdminBulkOrderTransitionDataDto {
  @ApiProperty({
    enum: [BulkOrderTransitionAction.SHIP, BulkOrderTransitionAction.DELIVER],
  })
  action!: BulkOrderTransitionAction;
  @ApiProperty({ type: AdminBulkOrderTransitionSummaryDto })
  summary!: AdminBulkOrderTransitionSummaryDto;
  @ApiProperty({
    type: [Object],
    description:
      'Results remain in the request order; each item is a success or failure object.',
  })
  results!: Array<
    AdminBulkOrderTransitionSuccessDto | AdminBulkOrderTransitionFailureDto
  >;
}

export class AdminBulkOrderTransitionResponseDto {
  @ApiProperty({ type: AdminBulkOrderTransitionDataDto })
  data!: AdminBulkOrderTransitionDataDto;
}

export function toAdminBulkOrderTransitionDto(
  result: BulkOrderTransitionResult,
): AdminBulkOrderTransitionResponseDto {
  return {
    data: {
      action: result.action,
      summary: result.summary,
      results: result.results.map((item) =>
        item.success
          ? {
              orderId: item.orderId,
              success: true,
              replay: item.replay,
              order: toAdminOrderDetailDto(item.order),
            }
          : {
              orderId: item.orderId,
              success: false,
              error: item.error,
            },
      ),
    },
  };
}
