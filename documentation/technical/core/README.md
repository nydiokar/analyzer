# 🔍 Core Analysis Engine - Deep Dive

## 🎯 Overview

The Core Analysis Engine is the **heart and brain** of the Wallet Analysis System. It contains all the business logic for analyzing wallet behavior, trading patterns, performance metrics, and similarity relationships. This engine is designed to be **framework-agnostic** and can be used by CLI scripts, API endpoints, and background workers.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CORE ANALYSIS ENGINE                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ BehaviorAnalyzer│  │SimilarityAnalyzer│  │CorrelationAnalyzer│  │
│  │                 │  │                 │  │                 │  │
│  │ • Trader        │  │ • Cosine        │  │ • Activity      │  │
│  │   Classification│  │   Similarity    │  │   Correlation   │  │
│  │ • Risk Metrics  │  │ • Clustering    │  │ • Pattern       │  │
│  │ • Session       │  │ • Vector        │  │   Recognition   │  │
│  │   Analysis      │  │   Generation    │  │ • Relationship  │  │
│  │ • Trading       │  │ • Token        │  │   Mapping       │  │
│  │   Frequency     │  │   Preferences   │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  SwapAnalyzer   │  │  StatsAnalyzer  │  │   BotDetector   │  │
│  │                 │  │                 │  │                 │  │
│  │ • Trade         │  │ • Performance   │  │ • Bot Behavior  │  │
│  │   Sequencing    │  │   Metrics       │  │   Detection     │  │
│  │ • Token         │  │ • Statistical   │  │ • Pattern       │  │
│  │   Flow          │  │   Analysis      │  │   Recognition   │  │
│  │ • Value         │  │ • Trend         │  │ • Automation    │  │
│  │   Tracking      │  │   Analysis      │  │   Indicators    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Directory Structure

```
src/core/
├── analysis/                    # Core analysis engines
│   ├── behavior/               # Behavioral analysis
│   │   ├── analyzer.ts         # Main behavior analyzer (1084 lines)
│   │   ├── behavior-service.ts # Service layer
│   │   ├── bot-detector.ts     # Bot behavior detection
│   │   └── types.ts            # Behavioral types
│   ├── similarity/              # Similarity analysis
│   │   ├── analyzer.ts         # Main similarity analyzer (347 lines)
│   │   ├── similarity-service.ts # Service layer
│   │   └── types.ts            # Similarity types
│   ├── correlation/             # Correlation analysis
│   │   ├── analyzer.ts         # Correlation analyzer
│   │   ├── correlation-service.ts # Service layer
│   │   └── types.ts            # Correlation types
│   ├── swap/                   # Swap analysis
│   │   └── analyzer.ts         # Swap pattern analyzer
│   └── stats/                  # Statistical analysis
│       └── analyzer.ts         # Statistical metrics
├── services/                    # Core business services
│   ├── database-service.ts     # Database operations
│   ├── helius-api-client.ts    # Helius API integration
│   ├── helius-sync-service.ts  # Data synchronization
│   ├── pnl-analysis-service.ts # P&L calculations
│   └── dexscreener-service.ts  # DexScreener integration
├── utils/                       # Utility functions
│   ├── logger.ts               # Logging utilities
│   ├── formatters.ts           # Data formatting
│   └── cliUtils.ts             # CLI utilities
└── bot/                        # Telegram bot interface
    ├── bot.ts                  # Main bot class
    └── commands.ts             # Bot commands
```

## 🔍 **Behavior Analyzer** - Deep Dive

### **Purpose & Capabilities**
The `BehaviorAnalyzer` is the most sophisticated component (1084 lines) that transforms raw swap records into comprehensive behavioral insights about wallet trading patterns.

### **Key Features**

#### **1. Token Trade Analysis**
- **Excluded Tokens**: Automatically filters out utility tokens (SOL, USDC, USDT) from behavioral analysis
- **Trade Sequencing**: Builds complete buy/sell sequences for each token
- **Direction Analysis**: Tracks inflow vs outflow patterns

#### **2. Behavioral Metrics**
```typescript
interface BehavioralMetrics {
  // Core flipper metrics
  buySellRatio: number;           // Ratio of buys to sells
  buySellSymmetry: number;        // Symmetry in trading patterns
  averageFlipDurationHours: number; // Average time between buy/sell
  medianHoldTime: number;         // Median holding duration
  
  // Risk metrics
  averageTransactionValueSol: number; // Average transaction size
  largestTransactionValueSol: number; // Largest single transaction
  
  // Trading frequency
  tradesPerDay: number;           // Daily trading rate
  tradesPerWeek: number;          // Weekly trading rate
  tradesPerMonth: number;         // Monthly trading rate
  
  // Session analysis
  sessionCount: number;           // Number of trading sessions
  avgTradesPerSession: number;    // Average trades per session
  averageSessionStartHour: number; // Typical session start time
  averageSessionDurationMinutes: number; // Session duration
}
```

#### **3. Trading Style Classification**
The analyzer automatically classifies wallets into trading styles:
- **Ultra-Fast**: < 1 hour holds
- **Very Fast**: 1-4 hour holds  
- **Fast**: 4-24 hour holds
- **Moderate**: 1-7 day holds
- **Day Trader**: 1-30 day holds
- **Swing**: 1-90 day holds
- **Position**: > 90 day holds

#### **4. Session Analysis**
- **Trading Windows**: Identifies active trading periods
- **Activity Focus**: Calculates concentration of trading activity
- **Time Distribution**: Maps trading patterns across hours/days

### **Technical Implementation**

#### **Core Analysis Flow**
```typescript
public analyze(rawSwapRecords: SwapAnalysisInput[]): BehavioralMetrics {
  // 1. Filter utility tokens
  const swapRecords = rawSwapRecords.filter(
    record => !EXCLUDED_TOKEN_MINTS.includes(record.mint)
  );
  
  // 2. Build token sequences
  const tokenSequences = this.buildTokenSequences(swapRecords);
  
  // 3. Calculate core metrics
  const metrics = this.calculateBehavioralMetrics(tokenSequences);
  
  // 4. Calculate risk metrics
  // 5. Calculate trading frequency
  // 6. Calculate session metrics
  // 7. Classify trading style
  
  return metrics;
}
```

#### **Token Sequence Building**
```typescript
private buildTokenSequences(swapRecords: SwapAnalysisInput[]): TokenTradeSequence[] {
  // Groups trades by token mint
  // Creates chronological sequences
  // Calculates buy/sell ratios per token
  // Identifies complete buy/sell pairs
}
```

#### **Performance Optimizations**
- **Early Filtering**: Utility tokens excluded before processing
- **Efficient Data Structures**: Uses Maps and Sets for O(1) lookups
- **Batch Processing**: Processes multiple metrics in single passes
- **Memory Management**: Minimal object creation during analysis

## 🔍 **Similarity Analyzer** - Deep Dive

### **Purpose & Capabilities**
The `SimilarityAnalyzer` identifies wallets with similar trading behaviors using vector mathematics and cosine similarity.

### **Key Features**

#### **1. Vector Types**
- **Capital Allocation Vectors**: Based on USD value invested in tokens
- **Binary Token Vectors**: Based on presence/absence of tokens

#### **2. Similarity Calculation**
```typescript
async calculateSimilarity(
  walletTransactions: Record<string, TransactionData[]>,
  vectorType: 'capital' | 'binary' = 'capital'
): Promise<SingleSimilarityResult>
```

#### **3. Cosine Similarity Matrix**
- Creates NxN similarity matrix for all wallet pairs
- Uses `compute-cosine-similarity` library
- Handles edge cases (empty wallets, no common tokens)

#### **4. Clustering & Aggregation**
- **Pairwise Similarities**: Direct wallet-to-wallet comparisons
- **Global Metrics**: Average similarity across all wallets
- **Most Similar Pairs**: Top matching wallet combinations

### **Technical Implementation**

#### **Vector Generation**
```typescript
private createCapitalAllocationVectors(
  walletData: Record<string, TransactionData[]>,
  allUniqueBoughtTokens: string[]
): Record<string, TokenVector> {
  // Creates normalized vectors based on capital allocation
  // Handles edge cases (empty wallets, missing data)
  // Returns sparse vectors for memory efficiency
}
```

#### **Similarity Matrix Calculation**
```typescript
private calculateCosineSimilarityMatrix(
  walletVectors: Record<string, TokenVector>,
  walletAddresses: string[]
): CorePairwiseResult[] {
  // Generates all pairwise combinations
  // Calculates cosine similarity for each pair
  // Filters out low-similarity results
}
```

## 🔍 **Correlation Analyzer** - Deep Dive

### **Purpose & Capabilities**
The `CorrelationAnalyzer` identifies relationships between different wallets' trading activities and market movements.

### **Key Features**
- **Activity Correlation**: Finds wallets that trade together
- **Pattern Recognition**: Identifies coordinated trading behavior
- **Market Impact Analysis**: Measures wallet influence on token prices

## 🔍 **Swap Analyzer** - Deep Dive

### **Purpose & Capabilities**
The `SwapAnalyzer` focuses specifically on swap transaction patterns and token flow analysis.

### **Key Features**
- **Trade Sequencing**: Maps complete buy/sell cycles
- **Token Flow Tracking**: Monitors token movement between wallets
- **Value Analysis**: Tracks SOL and USD values across trades

## 🔍 **Stats Analyzer** - Deep Dive

### **Purpose & Capabilities**
The `StatsAnalyzer` provides statistical analysis and trend identification for wallet performance.

### **Key Features**
- **Performance Metrics**: Win rates, return distributions
- **Trend Analysis**: Time-based performance patterns
- **Statistical Significance**: Confidence intervals and p-values

## 🚀 **Usage Examples**

### **Basic Behavior Analysis**
```typescript
import { BehaviorAnalyzer } from 'core/analysis/behavior/analyzer';
import { BehaviorAnalysisConfig } from '@/types/analysis';

const config: BehaviorAnalysisConfig = {
  excludedMints: ['custom_token_mint'],
  minTradeCount: 5,
  sessionTimeoutMinutes: 30
};

const analyzer = new BehaviorAnalyzer(config);
const metrics = analyzer.analyze(swapRecords);
console.log(`Trading Style: ${metrics.tradingStyle}`);
console.log(`Risk Score: ${metrics.riskMetrics.averageTransactionValueSol}`);
```

### **Similarity Analysis**
```typescript
import { SimilarityAnalyzer } from 'core/analysis/similarity/analyzer';

const analyzer = new SimilarityAnalyzer(config);
const result = await analyzer.calculateSimilarity(walletTransactions, 'capital');

console.log(`Most Similar Pair: ${result.globalMetrics.mostSimilarPairs[0]}`);
console.log(`Average Similarity: ${result.globalMetrics.averageSimilarity}`);
```

## 🔧 **Configuration Options**

### **Behavior Analysis Config**
```typescript
interface BehaviorAnalysisConfig {
  excludedMints?: string[];           // Tokens to exclude from analysis
  minTradeCount?: number;             // Minimum trades for classification
  sessionTimeoutMinutes?: number;     // Session timeout threshold
  riskThresholds?: {                  // Risk assessment thresholds
    highValueThreshold: number;       // High-value transaction threshold
    rapidTradeThreshold: number;      // Rapid trading threshold
  };
}
```

### **Similarity Analysis Config**
```typescript
interface SimilarityAnalysisConfig {
  excludedMints?: string[];           // Tokens to exclude
  minSimilarityThreshold?: number;    // Minimum similarity to report
  vectorType?: 'capital' | 'binary';  // Default vector type
  maxResults?: number;                // Maximum results to return
}
```

## 📊 **Performance Characteristics**

### **Time Complexity**
- **Behavior Analysis**: O(n) where n = number of swap records
- **Similarity Analysis**: O(n²) where n = number of wallets
- **Token Sequencing**: O(n log n) due to sorting operations

### **Memory Usage**
- **Behavior Analysis**: O(n) for token sequences
- **Similarity Analysis**: O(n × m) where m = number of unique tokens
- **Vector Storage**: Sparse vectors for memory efficiency

### **Scalability Considerations**
- **Large Wallets**: Handles wallets with 10,000+ transactions
- **Multiple Wallets**: Efficiently processes 100+ wallet comparisons
- **Token Diversity**: Scales with 1,000+ unique token mints

## 🧪 **Testing & Validation**

### **Test Coverage**
- **Unit Tests**: Individual analyzer methods
- **Integration Tests**: End-to-end analysis workflows
- **Performance Tests**: Large dataset processing
- **Edge Case Tests**: Empty data, single transactions, etc.

### **Validation Methods**
- **Cross-Reference**: Compare with external tools
- **Manual Review**: Expert validation of results
- **Statistical Validation**: Verify metric distributions
- **Performance Benchmarking**: Measure analysis speed

## 🔮 **Future Enhancements**

### **Planned Features**
- **Machine Learning**: Enhanced pattern recognition
- **Real-time Analysis**: Streaming transaction analysis
- **Advanced Clustering**: Hierarchical wallet grouping
- **Predictive Analytics**: Future behavior prediction

### **Performance Improvements**
- **Parallel Processing**: Multi-threaded analysis
- **Caching Layer**: Result caching for repeated analysis
- **Incremental Updates**: Delta-based analysis updates
- **Distributed Processing**: Multi-node analysis scaling

---

## 📚 **Related Documentation**

- **[API Layer](./../api/README.md)** - How the core engine is exposed via REST API
- **[Database Schema](./../database/README.md)** - Data structures and relationships
- **[Performance Tuning](./../performance/README.md)** - Optimization strategies
- **[Troubleshooting](./../guides/troubleshooting.md)** - Common issues and solutions
