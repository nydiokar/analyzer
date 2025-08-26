# 🔍 Core Analysis Engine

## 🎯 Overview

The Core Analysis Engine is the heart of the Wallet Analysis System, containing all the business logic for analyzing wallet behavior, trading patterns, and performance metrics. This engine is designed to be **framework-agnostic** and can be used by CLI scripts, API endpoints, and background workers.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CORE ANALYSIS ENGINE                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ BehaviorAnalyzer│  │SimilarityAnalyzer│  │CorrelationAnalyzer│  │
│  │                 │  │                 │  │                 │  │
│  │ • Trader        │  │ • Vector        │  │ • Pairwise      │  │
│  │   Classification│  │   Creation      │  │   Scoring       │  │
│  │ • Pattern       │  │ • Similarity    │  │ • Clustering    │  │
│  │   Recognition   │  │   Calculation   │  │ • Global Stats  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  SwapAnalyzer   │  │AdvancedStats    │  │ KPIComparison   │  │
│  │                 │  │  Analyzer       │  │   Analyzer      │  │
│  │ • Swap Detection│  │ • P&L Metrics  │  │ • Comparative   │  │
│  │ • FIFO P&L      │  │ • Win Rates    │  │   Analysis      │  │
│  │ • Token Tracking│  │ • Efficiency    │  │ • Performance   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UTILITY LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  • PNL Calculator    • Report Generators    • Data Formatters  │
│  • Validation Utils  • Math Helpers        • Type Guards      │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Core Components

### **1. BehaviorAnalyzer**
**Location**: `src/core/behavior/analyzer.ts`

**Purpose**: Analyzes wallet behavior patterns and classifies trader types.

**Key Features**:
- **Trader Classification**: Identifies trader types (e.g., "High-Frequency Sniper", "Passive Holder")
- **Pattern Recognition**: Detects trading patterns and session clustering
- **Consistency Metrics**: Calculates behavior consistency and efficiency scores
- **Strategic Tagging**: Applies behavioral tags for quick identification

**Usage Example**:
```typescript
import { BehaviorAnalyzer } from './core/behavior/analyzer';

const analyzer = new BehaviorAnalyzer();
const result = await analyzer.analyzeWalletBehavior(
  walletAddress,
  transactions,
  config
);
```

**Output Structure**:
```typescript
interface BehaviorAnalysisResult {
  traderClassification: string;
  strategicTags: string[];
  consistencyScore: number;
  efficiencyScore: number;
  patternTimeline: BehaviorPattern[];
  sessionMetrics: SessionMetrics;
}
```

### **2. SimilarityAnalyzer**
**Location**: `src/core/similarity/analyzer.ts`

**Purpose**: Finds wallets with similar trading behaviors using vector analysis.

**Key Features**:
- **Vector Creation**: Generates capital-based or binary vectors for wallets
- **Similarity Scoring**: Calculates cosine similarity between wallet vectors
- **Clustering**: Groups similar wallets together
- **Shared Token Analysis**: Identifies common tokens between similar wallets

**Usage Example**:
```typescript
import { SimilarityAnalyzer } from './core/similarity/analyzer';

const analyzer = new SimilarityAnalyzer();
const result = await analyzer.analyzeWalletSimilarity(
  walletAddresses,
  'capital', // or 'binary'
  config
);
```

**Output Structure**:
```typescript
interface SimilarityAnalysisResult {
  similarityMatrix: SimilarityScore[][];
  topSimilarPairs: SimilarityPair[];
  sharedTokenAnalysis: SharedTokenResult[];
  clusteringResults: WalletCluster[];
}
```

### **3. CorrelationAnalyzer**
**Location**: `src/core/correlation/analyzer.ts`

**Purpose**: Identifies correlations between wallet activities and market movements.

**Key Features**:
- **Pairwise Scoring**: Calculates correlation scores between wallet pairs
- **Market Correlation**: Links wallet behavior to market conditions
- **Clustering**: Groups correlated wallets together
- **Global Statistics**: Provides overview of correlation patterns

**Usage Example**:
```typescript
import { CorrelationAnalyzer } from './core/correlation/analyzer';

const analyzer = new CorrelationAnalyzer();
const result = await analyzer.analyzeCorrelations(
  walletAddresses,
  marketData,
  config
);
```

### **4. SwapAnalyzer**
**Location**: `src/core/swap/analyzer.ts`

**Purpose**: Analyzes individual swap transactions and calculates P&L.

**Key Features**:
- **Swap Detection**: Identifies SOL swaps from transaction data
- **FIFO P&L**: Calculates profit/loss using First-In-First-Out method
- **Token Tracking**: Monitors token holdings and exits
- **Fee Calculation**: Includes transaction fees in P&L calculations

### **5. AdvancedStatsAnalyzer**
**Location**: `src/core/stats/analyzer.ts`

**Purpose**: Calculates advanced trading statistics and performance metrics.

**Key Features**:
- **Win Rate Calculation**: Determines percentage of profitable trades
- **Efficiency Metrics**: Calculates trading efficiency and consistency
- **Risk Analysis**: Provides risk-adjusted performance metrics
- **Time-based Analysis**: Analyzes performance across different time periods

## 📊 Data Flow

### **Input Data Structure**
```typescript
interface AnalysisInput {
  walletAddress: string;
  transactions: Transaction[];
  config: AnalysisConfig;
  timeRange?: TimeRange;
  excludeMints?: string[];
}
```

### **Analysis Pipeline**
```
1. Data Validation → Input sanitization and validation
2. Transaction Mapping → Convert raw transactions to structured data
3. Core Analysis → Run relevant analyzers based on config
4. Result Aggregation → Combine results from multiple analyzers
5. Report Generation → Create human-readable reports
6. Data Persistence → Store results in database
```

## ⚙️ Configuration

### **Analysis Configuration**
```typescript
interface AnalysisConfig {
  analysisTypes: AnalysisType[];
  timeRange?: TimeRange;
  excludeMints?: string[];
  batchSize?: number;
  enableProgressTracking?: boolean;
  outputFormats?: OutputFormat[];
}
```

### **Supported Analysis Types**
- `'behavior'` - Behavioral pattern analysis
- `'similarity'` - Wallet similarity analysis
- `'correlation'` - Activity correlation analysis
- `'pnl'` - Profit and loss analysis
- `'stats'` - Advanced statistics calculation

## 🔄 Integration Points

### **With Services Layer**
The core analyzers are wrapped by service classes that provide:
- Database integration
- Configuration management
- Error handling
- Progress tracking

### **With CLI Scripts**
CLI scripts use the core analyzers directly for:
- Batch processing
- One-off analysis
- Testing and validation

### **With API Layer**
API endpoints use the core analyzers through services for:
- On-demand analysis
- Real-time processing
- Background job processing

## 🧪 Testing

### **Unit Testing**
Each analyzer has comprehensive unit tests covering:
- Input validation
- Core algorithm logic
- Edge cases and error conditions
- Performance characteristics

### **Integration Testing**
Integration tests verify:
- Analyzer interactions
- Data flow through the pipeline
- Service layer integration
- End-to-end analysis workflows

## 📈 Performance Characteristics

### **Scalability**
- **Small Wallets** (<1k transactions): <1 second
- **Medium Wallets** (1k-10k transactions): 1-10 seconds
- **Large Wallets** (10k-50k transactions): 10-60 seconds
- **Very Large Wallets** (>50k transactions): Not recommended with current architecture

### **Memory Usage**
- **Peak Memory**: ~100MB per 10k transactions
- **Memory Scaling**: Linear with transaction count
- **Garbage Collection**: Optimized for Node.js V8 engine

### **Optimization Strategies**
- **Batch Processing**: Process transactions in configurable batches
- **Lazy Evaluation**: Defer computation until needed
- **Memory Pooling**: Reuse objects to reduce GC pressure
- **Algorithm Selection**: Choose optimal algorithms based on data size

## 🔮 Future Enhancements

### **Planned Improvements**
- **Machine Learning Integration**: ML-based pattern recognition
- **Real-time Analysis**: Streaming analysis for live data
- **Advanced Clustering**: More sophisticated clustering algorithms
- **Performance Optimization**: GPU acceleration for large datasets

### **Extensibility**
The core engine is designed to be easily extensible:
- **Plugin Architecture**: Support for custom analyzers
- **Configuration-driven**: Easy to add new analysis types
- **Interface-based**: Clear contracts for new implementations

---

**Last Updated**: August 2025  
**Maintainer**: Core Engine Team  
**Related Docs**: 
- [API Reference](../api/README.md)
- [Service Layer](../services/README.md)
- [Database Schema](../database/README.md)
