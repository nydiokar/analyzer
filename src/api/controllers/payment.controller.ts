import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { User } from '@prisma/client';
import { PaymentService, CreditPackDto, CheckoutResponseDto, PaymentStatusDto } from '../services/payment.service';
import { CreditsService } from '../services/credits.service';

class CheckoutDto {
  @IsString()
  packId!: string;
}

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Payments')
@Controller('payments')
@ApiBearerAuth()
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly creditsService: CreditsService,
  ) {}

  @Get('packs')
  @ApiOperation({ summary: 'List available credit packs' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Active credit packs' })
  async listPacks(): Promise<CreditPackDto[]> {
    return this.paymentService.listPacks();
  }

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Create a payment intent and return a Solana Pay QR code' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Payment intent created with QR code' })
  async checkout(
    @Body() dto: CheckoutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CheckoutResponseDto> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.paymentService.checkout(userId, dto.packId);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Poll payment intent status' })
  @ApiParam({ name: 'id', description: 'Payment intent ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Payment status' })
  async getStatus(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentStatusDto> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.paymentService.getStatus(id, userId);
  }
}

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
export class UserCreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('me/credits')
  @ApiOperation({ summary: "Get the authenticated user's credit balance and recent transactions" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Credit balance and transaction history' })
  async getCredits(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    const [balance, transactions] = await Promise.all([
      this.creditsService.getBalance(userId),
      this.creditsService.getRecentTransactions(userId, 20),
    ]);
    return { balance: balance.credits, updatedAt: balance.updatedAt, transactions };
  }
}
