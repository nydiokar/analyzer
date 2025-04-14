# Component Documentation

## Core Modules

### 1. Data Fetcher (`src/core/fetcher/`)

#### Responsibilities
- Fetches real-time cryptocurrency data from CoinGecko API
- Implements rate limiting to prevent API abuse
- Transforms and validates incoming data
- Retrieves protocol-specific staking data

#### Key Classes
- `DataFetcher`: Main class for data retrieval
- `CoinGeckoClient`: API client implementation
- `ProtocolFetcher`: Staking protocol integration
- `RateLimiter`: Handles API request throttling

#### Configuration
- Update interval
- Rate limit settings
- Coin and currency selection
- Protocol configurations

### 2. Storage Manager (`src/core/storage/`)

#### Responsibilities
- Manages SQLite database operations
- Handles data persistence
- Implements data verification

#### Key Classes
- `SQLiteManager`: Database operations handler
- `DataVerifier`: Ensures data integrity

#### Features
- Transaction support
- Data validation
- Efficient querying
- Backup mechanisms

### 3. Analysis Engine (`src/core/analysis/`)

#### Responsibilities
- Processes and analyzes cryptocurrency data
- Calculates price changes and trends
- Performs staking calculations
- Generates market insights

#### Key Classes
- `CryptoAnalyzer`: Main analysis class
- `PriceCalculator`: Handles price calculations
- `TrendAnalyzer`: Identifies market trends
- `StakingCalculator`: Handles staking projections

#### Analysis Types
- Price change percentage
- Volume analysis
- Market cap changes
- Trend identification
- Staking return projections
- Compound interest calculations

### 4. Alert System (`src/core/alerts/`)

#### Responsibilities
- Manages alert configurations
- Triggers notifications
- Handles alert persistence

#### Key Classes
- `AlertManager`: Main alert handling class
- `NotificationHandler`: Manages notification delivery
- `AlertConfig`: Alert configuration management

#### Alert Types
- Price threshold alerts
- Volume alerts
- Trend alerts
- Custom condition alerts

### 5. Telegram Bot (`src/bot/`)

#### Responsibilities
- Provides user interface
- Handles commands
- Manages user interactions
- Offers staking calculations

#### Key Classes
- `CryptoBot`: Main bot class
- `CommandHandler`: Processes user commands
- `MessageFormatter`: Formats bot responses
- `StakingHelper`: Handles staking queries

#### Commands
- `/addcoin`: Add coin to monitor
- `/removecoin`: Remove coin from monitoring
- `/listcoins`: List monitored coins
- `/stake`: Calculate staking returns
- `/help`: Show help information

### 6. Staking Calculator (`src/scripts/`)

#### Responsibilities
- Calculates potential staking returns
- Fetches protocol-specific data
- Generates detailed reports
- Assesses investment risks

#### Key Components
- `staking-calc.ts`: Main calculator script
- `run-staking.bat`: CLI interface
- Protocol configurations
- Risk assessment module

#### Features
- Multiple staking types support
- Real-time data integration
- Compound interest calculations
- Comprehensive reporting
- Risk analysis

## Utility Modules

### 1. Logger (`src/utils/logger.ts`)

#### Features
- Configurable logging levels
- File and console output
- Error tracking
- Performance monitoring

### 2. Configuration (`src/utils/config.ts`)

#### Features
- Environment variable management
- Default value handling
- Configuration validation
- Type-safe settings

### 3. Data Viewing (`src/utils/view-data.ts`)

#### Features
- Database query interface
- Data export capabilities
- Custom query support
- Format conversion

## Data Types

### Core Types (`src/types/`)

#### Key Types
- `CryptoData`: Main data structure
- `AlertConfig`: Alert configuration
- `RateLimitConfig`: API rate limiting settings
- `CryptoDataOptions`: Data fetching options
- `StakingInfo`: Staking parameters
- `StakingReport`: Calculation results

## Integration Points

### 1. API Integration
- CoinGecko API for prices
- Marinade API for staking data
- Rate limiting implementation
- Error handling

### 2. Protocol Integration
- Native Solana staking
- Marinade liquid staking
- Protocol-specific APIs
- Risk assessment integration

### 3. Database Integration
- SQLite schema
- Query optimization
- Data validation
- Backup procedures

### 4. Notification Integration
- Telegram API
- Message formatting
- Command processing
- User management 