# Crypto Price Monitor & Staking Calculator - Architecture Overview

## System Architecture

The system is a TypeScript-based application that follows a modular architecture with clear separation of concerns. It provides both real-time cryptocurrency price monitoring with alerting capabilities and advanced staking calculations.

### Core Components

1. **Data Fetcher (`src/core/fetcher/`)**
   - Responsible for fetching cryptocurrency data from CoinGecko API
   - Retrieves protocol-specific staking data (Marinade, etc.)
   - Implements rate limiting to respect API constraints
   - Handles data transformation and validation

2. **Storage Manager (`src/core/storage/`)**
   - Manages SQLite database operations
   - Handles data persistence and retrieval
   - Implements data verification mechanisms

3. **Analysis Engine (`src/core/analysis/`)**
   - Processes and analyzes cryptocurrency data
   - Calculates price changes and trends
   - Performs staking return calculations
   - Generates market insights and risk assessments

4. **Alert System (`src/core/alerts/`)**
   - Manages alert configurations
   - Triggers notifications based on price thresholds
   - Supports multiple notification channels (Telegram)

5. **Telegram Bot (`src/bot/`)**
   - Provides interactive interface for users
   - Handles command processing
   - Manages alert subscriptions
   - Offers quick staking calculations via commands

6. **Staking Calculator (`src/scripts/`)**
   - Calculates potential staking returns
   - Integrates with protocol-specific APIs
   - Generates detailed staking reports
   - Provides risk assessments

### Data Flow

1. **Price Data Collection**
   ```
   CoinGecko API -> Data Fetcher -> Storage Manager -> SQLite Database
   ```

2. **Analysis Pipeline**
   ```
   Storage Manager -> Analysis Engine -> Alert System -> Notification Channels
   ```

3. **User Interaction**
   ```
   Telegram Bot <-> Alert System <-> Storage Manager
   ```

4. **Staking Calculations**
   ```
   Protocol APIs -> Data Fetcher -> Staking Calculator -> Report Generation
   ```

### Key Features

- Real-time price monitoring
- Configurable alert thresholds
- Multiple currency support
- Rate-limited API access
- Data verification and integrity checks
- Telegram bot integration
- CLI interface for management
- Staking return calculations
- Protocol-specific integrations
- Risk assessment reporting

### Dependencies

- **External APIs**
  - CoinGecko API for cryptocurrency data
  - Marinade Finance API for staking data
  - Other protocol-specific APIs

- **Core Libraries**
  - `axios`: HTTP client for API requests
  - `better-sqlite3`: SQLite database management
  - `telegraf`: Telegram bot framework
  - `winston`: Logging system
  - `yargs`: Command-line argument parsing

### Security Considerations

- API rate limiting
- Environment variable configuration
- Data verification mechanisms
- Process locking to prevent multiple instances
- Secure storage of sensitive data
- Conservative fallback values for staking
- Protocol-specific risk handling

### Scalability

The system is designed to be scalable through:
- Modular architecture
- Configurable update intervals
- Efficient database operations
- Rate-limited API access
- Asynchronous processing
- Protocol-agnostic interfaces
- Extensible calculation engine