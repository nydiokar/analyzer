# EV Tracking Implementation Plan - "The Sentinel" Feature

## Executive Summary

This document outlines the implementation of a minimalistic Expected Value (EV) tracking system for short-term crypto traders - "The Sentinel". The feature provides real-time clarity on trading performance to prevent emotional decision making during downtrends, similar to casino atmosphere awareness tools.

## Core Proposition

### The Problem
- Traders lose money due to emotional decision making during downtrends
- Lack of real-time awareness of edge decay
- No clear signal when to stop trading (similar to casino "fog" effect)

### The Solution
A simple, real-time EV calculation engine that:
- Tracks win/loss ratio using Bayesian posterior update
- Calculates expected value per trade
- Provides clear visual signals (Green/Yellow/Red)
- Operates on minimal computational overhead

## System Architecture Overview

### Current Infrastructure Leverage
The existing Sova Intel system provides:
- **NestJS Backend** with WebSocket support (`JobProgressGateway`)
- **Redis** for real-time pub/sub messaging
- **Prisma ORM** with SQLite database
- **Helius API** integration for transaction data
- **Dashboard** with real-time update capabilities

### New Components Required
1. **EV Trading Session Service** - Core calculation logic
2. **Helius WebSocket Client** - Real-time transaction monitoring  
3. **Trade Detection Engine** - Identify and classify trades
4. **EV WebSocket Gateway** - Real-time updates to dashboard
5. **Database Schema Extensions** - Store session and trade data

## Technical Implementation Details

### 1. Database Schema Extensions

```sql
-- New tables to add to schema.prisma

model TradingSession {
  id            String   @id @default(uuid())
  walletAddress String
  startTime     DateTime @default(now())
  endTime       DateTime?
  isActive      Boolean  @default(true)
  
  // Session configuration
  profitThreshold    Float   @default(0.05) // 5% profit threshold
  timeWindowMinutes  Int     @default(60)   // Max 1 hour per trade
  
  // Current EV state
  totalTrades       Int     @default(0)
  winningTrades     Int     @default(0)
  currentEV         Float   @default(0.0)
  currentWinRate    Float   @default(0.0)
  
  trades            Trade[]
  evSnapshots       EVSnapshot[]
  
  @@index([walletAddress, isActive])
  @@index([startTime])
}

model Trade {
  id                String         @id @default(uuid())
  sessionId         String
  signature         String         @unique
  
  // Trade details
  entryTime         DateTime
  exitTime          DateTime?
  entryPrice        Float
  exitPrice         Float?
  sizeUsd           Float
  status            TradeStatus    @default(OPEN)
  
  // Classification
  isWin             Boolean?
  actualProfitLoss  Float?
  profitPercentage  Float?
  
  session           TradingSession @relation(fields: [sessionId], references: [id])
  
  @@index([sessionId])
  @@index([entryTime])
  @@index([status])
}

model EVSnapshot {
  id            String         @id @default(uuid())
  sessionId     String
  timestamp     DateTime       @default(now())
  
  // EV calculation inputs
  totalTrades   Int
  winningTrades Int
  winRate       Float
  
  // EV calculation outputs  
  expectedValue Float
  signal        EVSignal       // GREEN, YELLOW, RED
  
  session       TradingSession @relation(fields: [sessionId], references: [id])
  
  @@index([sessionId, timestamp])
}

enum TradeStatus {
  OPEN
  CLOSED
  EXPIRED
}

enum EVSignal {
  GREEN
  YELLOW  
  RED
}
```

### 2. Core EV Calculation Service

```typescript
// src/core/services/ev-calculation.service.ts

@Injectable()
export class EVCalculationService {
  private readonly logger = new Logger(EVCalculationService.name);
  
  constructor(private prisma: PrismaService) {}
  
  /**
   * Calculate EV using Bayesian posterior update
   * θ = (k + 1) / (n + 2)
   * EV = θ * R - (1 - θ) * L
   */
  calculateEV(trades: number, wins: number, avgWinUsd: number = 80, avgLossUsd: number = 40): EVResult {
    // Bayesian posterior update with uniform prior
    const theta = (wins + 1) / (trades + 2);
    
    // Expected Value calculation
    const expectedValue = theta * avgWinUsd - (1 - theta) * avgLossUsd;
    
    // Signal classification
    let signal: EVSignal;
    if (expectedValue > 20) {
      signal = EVSignal.GREEN;
    } else if (expectedValue > -20) {
      signal = EVSignal.YELLOW;
    } else {
      signal = EVSignal.RED;
    }
    
    return {
      totalTrades: trades,
      winningTrades: wins,
      winRate: theta,
      expectedValue,
      signal,
      timestamp: new Date()
    };
  }
  
  async updateSessionEV(sessionId: string): Promise<EVResult> {
    const session = await this.prisma.tradingSession.findUnique({
      where: { id: sessionId },
      include: { trades: { where: { status: TradeStatus.CLOSED } } }
    });
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const closedTrades = session.trades;
    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(trade => trade.isWin).length;
    
    const evResult = this.calculateEV(totalTrades, winningTrades);
    
    // Update session with new EV data
    await this.prisma.tradingSession.update({
      where: { id: sessionId },
      data: {
        totalTrades,
        winningTrades,
        currentEV: evResult.expectedValue,
        currentWinRate: evResult.winRate
      }
    });
    
    // Store EV snapshot
    await this.prisma.eVSnapshot.create({
      data: {
        sessionId,
        totalTrades,
        winningTrades,
        winRate: evResult.winRate,
        expectedValue: evResult.expectedValue,
        signal: evResult.signal
      }
    });
    
    return evResult;
  }
}

interface EVResult {
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  expectedValue: number;
  signal: EVSignal;
  timestamp: Date;
}
```

### 3. Helius WebSocket Integration

```typescript
// src/core/services/helius-websocket.service.ts

@Injectable()
export class HeliusWebSocketService {
  private readonly logger = new Logger(HeliusWebSocketService.name);
  private wsConnection: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 1000; // Start with 1 second
  
  constructor(
    private readonly tradeDetectionService: TradeDetectionService,
    private readonly evGateway: EVWebSocketGateway
  ) {}
  
  async subscribeToWallet(walletAddress: string): Promise<void> {
    const wsUrl = `wss://atlas-mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    
    try {
      this.wsConnection = new WebSocket(wsUrl);
      
      this.wsConnection.onopen = () => {
        this.logger.log(`Connected to Helius WebSocket for wallet: ${walletAddress}`);
        this.reconnectAttempts = 0;
        this.sendSubscription(walletAddress);
      };
      
      this.wsConnection.onmessage = (event) => {
        this.handleTransactionUpdate(event.data, walletAddress);
      };
      
      this.wsConnection.onclose = () => {
        this.logger.warn('Helius WebSocket connection closed');
        this.scheduleReconnect(walletAddress);
      };
      
      this.wsConnection.onerror = (error) => {
        this.logger.error('Helius WebSocket error:', error);
      };
      
    } catch (error) {
      this.logger.error('Failed to connect to Helius WebSocket:', error);
      this.scheduleReconnect(walletAddress);
    }
  }
  
  private sendSubscription(walletAddress: string): void {
    const subscriptionRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "transactionSubscribe",
      params: [
        {
          failed: false,
          accountInclude: [walletAddress]
        },
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          maxSupportedTransactionVersion: 0
        }
      ]
    };
    
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(subscriptionRequest));
      this.logger.log(`Subscribed to transactions for wallet: ${walletAddress}`);
    }
  }
  
  private async handleTransactionUpdate(data: string, walletAddress: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      
      if (message.params?.result) {
        const transaction = message.params.result;
        
        // Detect if this is a relevant trade
        const detectedTrade = await this.tradeDetectionService.detectTrade(transaction, walletAddress);
        
        if (detectedTrade) {
          // Broadcast trade update via WebSocket
          await this.evGateway.broadcastTradeUpdate(walletAddress, detectedTrade);
        }
      }
    } catch (error) {
      this.logger.error('Error processing transaction update:', error);
    }
  }
  
  private scheduleReconnect(walletAddress: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts), 30000);
    
    setTimeout(() => {
      this.logger.log(`Reconnecting to Helius WebSocket (attempt ${this.reconnectAttempts})`);
      this.subscribeToWallet(walletAddress);
    }, delay);
  }
}
```

### 4. Trade Detection Engine

```typescript
// src/core/services/trade-detection.service.ts

@Injectable()
export class TradeDetectionService {
  private readonly logger = new Logger(TradeDetectionService.name);
  
  constructor(
    private prisma: PrismaService,
    private evCalculationService: EVCalculationService
  ) {}
  
  async detectTrade(transaction: any, walletAddress: string): Promise<DetectedTrade | null> {
    const logs = transaction.transaction?.meta?.logMessages || [];
    const signature = transaction.signature;
    
    // Check if this is a swap transaction
    const isSwap = logs.some(log => 
      log.includes('Program log: Instruction: Swap') ||
      log.includes('Program log: swap') ||
      log.includes('Jupiter') ||
      log.includes('Raydium')
    );
    
    if (!isSwap) {
      return null;
    }
    
    // Extract trade details from transaction
    const tradeDetails = this.extractTradeDetails(transaction, walletAddress);
    
    if (!tradeDetails) {
      return null;
    }
    
    // Check if this is opening or closing a position
    const activeSession = await this.getActiveSession(walletAddress);
    
    if (!activeSession) {
      // No active session, this might be opening a new position
      return await this.handleNewPosition(tradeDetails, walletAddress);
    }
    
    // Check if this closes an existing position
    return await this.handlePositionUpdate(tradeDetails, activeSession);
  }
  
  private extractTradeDetails(transaction: any, walletAddress: string): TradeDetails | null {
    try {
      const preBalances = transaction.transaction.meta.preTokenBalances || [];
      const postBalances = transaction.transaction.meta.postTokenBalances || [];
      
      // Simple heuristic: look for SOL/WSOL to token swaps
      // In production, this would be more sophisticated
      const solMint = 'So11111111111111111111111111111111111111112'; // WSOL
      
      // Find balance changes for the wallet
      const relevantChanges = this.findBalanceChanges(preBalances, postBalances, walletAddress);
      
      if (relevantChanges.length < 2) {
        return null; // Need at least 2 token changes for a swap
      }
      
      return {
        signature: transaction.signature,
        timestamp: new Date(transaction.blockTime * 1000),
        tokenChanges: relevantChanges,
        rawTransaction: transaction
      };
      
    } catch (error) {
      this.logger.error('Error extracting trade details:', error);
      return null;
    }
  }
  
  private findBalanceChanges(preBalances: any[], postBalances: any[], walletAddress: string): TokenChange[] {
    const changes: TokenChange[] = [];
    
    // Simple implementation - would need refinement for production
    for (const post of postBalances) {
      if (post.owner !== walletAddress) continue;
      
      const pre = preBalances.find(p => 
        p.owner === walletAddress && 
        p.mint === post.mint && 
        p.accountIndex === post.accountIndex
      );
      
      const preAmount = pre ? parseFloat(pre.uiTokenAmount.uiAmountString || '0') : 0;
      const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0');
      const change = postAmount - preAmount;
      
      if (Math.abs(change) > 0.000001) { // Ignore dust
        changes.push({
          mint: post.mint,
          change,
          decimals: post.uiTokenAmount.decimals
        });
      }
    }
    
    return changes;
  }
  
  private async getActiveSession(walletAddress: string): Promise<TradingSession | null> {
    return this.prisma.tradingSession.findFirst({
      where: {
        walletAddress,
        isActive: true
      },
      include: {
        trades: {
          where: { status: TradeStatus.OPEN }
        }
      }
    });
  }
  
  private async handleNewPosition(tradeDetails: TradeDetails, walletAddress: string): Promise<DetectedTrade> {
    // Create new session if none exists
    let session = await this.getActiveSession(walletAddress);
    
    if (!session) {
      session = await this.prisma.tradingSession.create({
        data: {
          walletAddress,
          isActive: true
        }
      });
    }
    
    // Create new trade record
    const trade = await this.prisma.trade.create({
      data: {
        sessionId: session.id,
        signature: tradeDetails.signature,
        entryTime: tradeDetails.timestamp,
        entryPrice: this.calculateEntryPrice(tradeDetails),
        sizeUsd: this.calculateSizeUsd(tradeDetails),
        status: TradeStatus.OPEN
      }
    });
    
    return {
      type: 'POSITION_OPENED',
      trade,
      session
    };
  }
  
  private calculateEntryPrice(tradeDetails: TradeDetails): number {
    // Simplified price calculation
    // In production, would use proper price feeds or DEX price discovery
    return 1.0; // Placeholder
  }
  
  private calculateSizeUsd(tradeDetails: TradeDetails): number {
    // Calculate USD size of the trade
    // In production, would use price oracles
    return 100.0; // Placeholder
  }
}

interface TradeDetails {
  signature: string;
  timestamp: Date;
  tokenChanges: TokenChange[];
  rawTransaction: any;
}

interface TokenChange {
  mint: string;
  change: number;
  decimals: number;
}

interface DetectedTrade {
  type: 'POSITION_OPENED' | 'POSITION_CLOSED';
  trade: any; // Trade record
  session: any; // TradingSession record
}
```

### 5. EV WebSocket Gateway

```typescript
// src/api/websocket/ev-websocket.gateway.ts

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/ev-tracker',
})
export class EVWebSocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EVWebSocketGateway.name);
  private readonly clientSubscriptions = new Map<string, Set<string>>(); // clientId -> walletAddresses

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly evCalculationService: EVCalculationService
  ) {}

  afterInit(server: Server) {
    this.logger.log('EV WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    const clientId = client.id;
    this.logger.log(`EV Client connected: ${clientId}`);
    this.clientSubscriptions.set(clientId, new Set());
    
    client.emit('connected', { 
      message: 'Connected to EV tracker', 
      clientId, 
      timestamp: Date.now() 
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`EV Client disconnected: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
  }

  @SubscribeMessage('subscribe-wallet')
  async handleSubscribeToWallet(
    @MessageBody() data: { walletAddress: string }, 
    @ConnectedSocket() client: Socket
  ) {
    const { walletAddress } = data;
    const clientId = client.id;
    
    if (walletAddress) {
      const subscriptions = this.clientSubscriptions.get(clientId);
      if (subscriptions) {
        subscriptions.add(walletAddress);
        this.logger.log(`Client ${clientId} subscribed to wallet: ${walletAddress}`);
        
        // Send current EV state
        await this.sendCurrentEVState(clientId, walletAddress);
      }
    }
  }

  @SubscribeMessage('unsubscribe-wallet')
  handleUnsubscribeFromWallet(
    @MessageBody() data: { walletAddress: string }, 
    @ConnectedSocket() client: Socket
  ) {
    const { walletAddress } = data;
    const clientId = client.id;
    
    if (walletAddress) {
      const subscriptions = this.clientSubscriptions.get(clientId);
      if (subscriptions) {
        subscriptions.delete(walletAddress);
        this.logger.log(`Client ${clientId} unsubscribed from wallet: ${walletAddress}`);
      }
    }
  }

  async broadcastTradeUpdate(walletAddress: string, detectedTrade: DetectedTrade) {
    // Calculate updated EV if position was closed
    if (detectedTrade.type === 'POSITION_CLOSED') {
      const evResult = await this.evCalculationService.updateSessionEV(detectedTrade.session.id);
      
      // Broadcast to all subscribed clients
      for (const [clientId, subscriptions] of this.clientSubscriptions) {
        if (subscriptions.has(walletAddress)) {
          this.server.to(clientId).emit('ev-update', {
            walletAddress,
            ...evResult,
            trade: detectedTrade.trade
          });
        }
      }
    } else {
      // Just broadcast the new position opening
      for (const [clientId, subscriptions] of this.clientSubscriptions) {
        if (subscriptions.has(walletAddress)) {
          this.server.to(clientId).emit('position-opened', {
            walletAddress,
            trade: detectedTrade.trade
          });
        }
      }
    }
  }

  private async sendCurrentEVState(clientId: string, walletAddress: string) {
    try {
      const activeSession = await this.prisma.tradingSession.findFirst({
        where: {
          walletAddress,
          isActive: true
        },
        include: {
          trades: true,
          evSnapshots: {
            orderBy: { timestamp: 'desc' },
            take: 1
          }
        }
      });

      if (activeSession && activeSession.evSnapshots.length > 0) {
        const latestSnapshot = activeSession.evSnapshots[0];
        
        this.server.to(clientId).emit('ev-state', {
          walletAddress,
          totalTrades: latestSnapshot.totalTrades,
          winningTrades: latestSnapshot.winningTrades,
          winRate: latestSnapshot.winRate,
          expectedValue: latestSnapshot.expectedValue,
          signal: latestSnapshot.signal,
          timestamp: latestSnapshot.timestamp
        });
      } else {
        // Send default state for new sessions
        this.server.to(clientId).emit('ev-state', {
          walletAddress,
          totalTrades: 0,
          winningTrades: 0,
          winRate: 0.5, // Prior assumption
          expectedValue: 0,
          signal: 'YELLOW',
          timestamp: new Date()
        });
      }
    } catch (error) {
      this.logger.error('Error sending current EV state:', error);
    }
  }
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- **Day 1-2**: Database schema updates and migrations
- **Day 3-4**: Core EV calculation service implementation
- **Day 5-7**: Basic trade detection service (simplified heuristics)

### Phase 2: Real-time Integration (Week 2)  
- **Day 1-3**: Helius WebSocket client implementation
- **Day 4-5**: EV WebSocket gateway development
- **Day 6-7**: Integration testing and basic UI components

### Phase 3: Enhancement & Production (Week 3)
- **Day 1-3**: Improved trade detection algorithms
- **Day 4-5**: Dashboard UI integration
- **Day 6-7**: Performance optimization and monitoring

## Dashboard Integration

### Simple Panel Design
```typescript
// Dashboard component structure
interface EVPanelProps {
  walletAddress: string;
}

const EVPanel: React.FC<EVPanelProps> = ({ walletAddress }) => {
  return (
    <div className="ev-panel">
      <div className="signal-indicator">
        <div className={`signal-dot ${signal.toLowerCase()}`} />
        <span className="signal-text">EV: {expectedValue > 0 ? '+' : ''}{expectedValue.toFixed(1)}</span>
      </div>
      <div className="stats">
        <span>Success Rate: {(winRate * 100).toFixed(1)}%</span>
        <span>Trades: {totalTrades}</span>
      </div>
    </div>
  );
};
```

### Signal Color Coding
- **🟢 Green**: EV > +20 (Keep trading, good conditions)
- **🟡 Yellow**: -20 ≤ EV ≤ +20 (Caution, volatile conditions)  
- **🔴 Red**: EV < -20 (Stop trading, losing edge)

## API Endpoints

### REST Endpoints
```typescript
// GET /api/ev/session/{walletAddress}
// Returns current active session state

// POST /api/ev/session/{walletAddress}/start
// Starts new EV tracking session

// POST /api/ev/session/{walletAddress}/stop  
// Ends current session

// GET /api/ev/history/{walletAddress}
// Returns historical EV snapshots
```

## Risk Considerations & Limitations

### Technical Risks
1. **Helius API Dependency**: Reliance on Helius transaction parsing accuracy
2. **WebSocket Stability**: Connection drops may miss trades
3. **Trade Detection Accuracy**: Simplified heuristics may misclassify transactions
4. **Price Discovery**: Simplified price calculations may be inaccurate

### Scope Limitations  
1. **No Multi-day Positions**: Only intraday trading (< 1 hour positions)
2. **SOL-based Only**: Focus on SOL as base currency
3. **No DCA Support**: No dollar-cost averaging strategies
4. **Binary Win/Loss**: No partial position management

### Mitigation Strategies
1. **Graceful Degradation**: System continues with cached data during outages
2. **Manual Override**: Allow users to manually mark trades
3. **Confidence Scoring**: Include confidence levels for trade detection
4. **Backup Data Sources**: Plan for alternative transaction monitoring

## Success Metrics

### Technical KPIs
- **Latency**: < 2 seconds from transaction to EV update
- **Accuracy**: > 90% correct trade detection
- **Uptime**: > 99% WebSocket connection stability
- **Performance**: < 100ms EV calculation time

### User Experience KPIs  
- **Signal Clarity**: Clear visual indicators
- **Responsiveness**: Real-time updates without lag
- **Simplicity**: Single-panel interface
- **Reliability**: Consistent performance during high-volume periods

## Future Enhancements

### Advanced Features (Post-MVP)
1. **Multi-timeframe Analysis**: Different session windows
2. **Risk-adjusted EV**: Incorporate volatility metrics
3. **Strategy Backtesting**: Historical EV simulation
4. **Social Features**: Leaderboards and sharing
5. **Advanced Trade Detection**: ML-based classification
6. **Multi-asset Support**: Beyond SOL trading pairs

### Integration Opportunities
1. **Telegram Bot**: EV alerts via messaging
2. **Mobile App**: Push notifications for signal changes
3. **Trading Bot Integration**: Automated stop-loss triggers
4. **Portfolio Analytics**: Integration with existing PnL tracking

## Conclusion

This implementation provides a minimal viable product for real-time EV tracking that can be developed and deployed within 2-3 weeks. The system leverages existing infrastructure while adding focused functionality for short-term trading clarity.

The design prioritizes simplicity, performance, and reliability over complex features, aligning with the "sniper's sidearm" philosophy outlined in the original blueprint. The modular architecture allows for future enhancements without disrupting core functionality.

Key success factors:
- **Minimalistic UI**: Single signal, clear meaning
- **Real-time Updates**: Instant feedback on trading performance  
- **Robust Infrastructure**: Built on proven WebSocket and database foundations
- **Extensible Design**: Ready for future feature additions