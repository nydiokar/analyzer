# Token Alerts System - Architecture Document

## Overview

A production-ready alerts system for Solana token monitoring that enables users to receive notifications based on price movements, activity, market changes, and custom conditions.

**Design Goals:**
- ✅ **Reliable**: Alerts fire when they should, with retry logic and observability
- ✅ **Scalable**: Handles 10K+ alerts without performance degradation
- ✅ **Flexible**: Supports simple and complex alert conditions
- ✅ **User-Friendly**: Smart grouping, templates, feedback loops
- ✅ **Future-Proof**: Easy migration from polling to event-driven

---

## Alert Types

### 1. Price Alerts
- Price crosses threshold (above/below)
- Percentage change in timeframe (±10% in 1h, ±50% in 24h)
- All-time high/low reached

### 2. Activity Alerts
- New message posted in token thread
- Token mentioned by specific user
- Token tagged with specific tag (@risk:rug, @meta:elon)

### 3. Market Alerts
- Liquidity drops below threshold
- Volume spike (e.g., 5× average)
- Market cap milestone ($1M, $10M, $100M)

### 4. Smart Alerts (Future)
- First message from analyzed wallet
- Token graduation event
- Cross-token ratio alerts (BONK/SOL)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                   USER CREATES ALERT                        │
│  "Notify me when $BONK price > $0.00001"                   │
│  Channels: In-app, Telegram                                │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│              DATABASE (Alert Rules)                         │
│  TokenAlert: condition, channels, priority, cooldown       │
│  AlertNotification: history, delivery status, feedback     │
│  AlertTemplate: reusable popular alerts                    │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│         EVALUATION ENGINE (BullMQ Background Job)           │
│  - Runs every 5 minutes (configurable)                     │
│  - Batches alerts by token for efficiency                  │
│  - Supports composite conditions (AND/OR logic)            │
│  - Auto-enriches stale price data                          │
│  - Tracks failures, auto-disables broken alerts            │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│               DELIVERY SERVICE                              │
│  - Smart grouping (3 alerts → 1 notification)              │
│  - Multi-channel: in-app, browser push, Telegram, email   │
│  - Retry logic with exponential backoff                    │
│  - Delivery status tracking per channel                    │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│                    USER RECEIVES                            │
│  In-app notification (socket broadcast)                    │
│  Browser push (Web Push API)                               │
│  Telegram message (existing bot integration)               │
└────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

```prisma
model TokenAlert {
  id           String    @id @default(cuid())
  userId       String
  tokenAddress String

  // Metadata
  label        String?           // User-friendly name
  description  String?           // User notes
  priority     AlertPriority @default(NORMAL) // CRITICAL | NORMAL | INFO

  // Condition Logic (supports composite AND/OR)
  conditions   Json
  /*
    Simple example:
    { "type": "price", "operator": "gt", "value": 0.01, "field": "priceUsd" }

    Composite example:
    {
      "operator": "AND",
      "rules": [
        { "type": "price", "operator": "gt", "value": 0.01, "field": "priceUsd" },
        { "type": "volume", "operator": "gt", "value": 1000000, "field": "volume24h" }
      ]
    }

    Percentage change example:
    { "type": "price_change", "operator": "gt", "value": 20, "timeframe": "1h", "field": "priceUsd" }
  */

  // Behavior
  mode         AlertMode @default(RECURRING) // ONE_SHOT | RECURRING
  isActive     Boolean   @default(true)

  // Timing Controls
  cooldownMinutes Int    @default(60)        // Wait 60min between triggers
  activeHoursUtc  Json?                      // { start: 13, end: 21 } = 9am-5pm ET

  // Delivery Preferences
  channels     Json                           // ["in_app", "telegram", "browser_push"]

  // State Machine
  state        AlertState @default(ACTIVE)    // ACTIVE | TRIGGERED | SNOOZED | DISABLED
  lastEvaluatedAt  DateTime?
  lastTriggeredAt  DateTime?
  triggerCount     Int      @default(0)
  snoozedUntil     DateTime?

  // Observability
  evaluationCount  Int      @default(0)
  failureCount     Int      @default(0)
  lastError        String?

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  User         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  TokenInfo    TokenInfo @relation(fields: [tokenAddress], references: [tokenAddress], onDelete: Cascade)
  notifications AlertNotification[]

  // Indexes for efficient querying
  @@index([userId, isActive, state])
  @@index([tokenAddress, isActive, state])
  @@index([state, lastEvaluatedAt])     // For picking next batch
  @@index([priority, state])            // For priority evaluation
}

model AlertNotification {
  id        String   @id @default(cuid())
  alertId   String
  userId    String

  // Trigger Context
  triggeredAt DateTime @default(now())
  snapshot    Json     // Full token state at trigger time

  // Grouping (prevents spam)
  groupKey    String?  // "token:BONK:2025-10-03-18" (token + hour)

  // Delivery Status
  channels    Json
  /*
    {
      "in_app": { "status": "sent", "sentAt": "2025-10-03T18:30:00Z" },
      "telegram": { "status": "delivered", "deliveredAt": "2025-10-03T18:30:02Z" },
      "browser_push": { "status": "failed", "error": "Push subscription expired" }
    }
  */

  // User Interaction
  isRead      Boolean  @default(false)
  readAt      DateTime?
  dismissed   Boolean  @default(false)
  feedback    String?  // "too_noisy" | "helpful" | "false_positive"

  Alert       TokenAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)
  User        User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead, dismissed])
  @@index([triggeredAt])
  @@index([groupKey, triggeredAt])
  @@index([alertId, triggeredAt])
}

model AlertTemplate {
  id          String   @id @default(cuid())
  name        String   // "Price Moon Alert"
  description String   // "Get notified when price pumps 20% in 1 hour"
  category    String   // "price" | "activity" | "market"
  conditions  Json     // Reusable condition structure
  popularity  Int      @default(0)
  createdBy   String?  // null = system template
  isPublic    Boolean  @default(false)

  @@index([isPublic, popularity])
}

enum AlertPriority {
  CRITICAL  // Red badge, always deliver immediately
  NORMAL    // Default priority
  INFO      // Low priority, can batch/delay
}

enum AlertMode {
  ONE_SHOT   // Fire once then auto-disable
  RECURRING  // Keep firing per cooldown rules
}

enum AlertState {
  ACTIVE     // Actively evaluating
  TRIGGERED  // Just fired, in cooldown period
  SNOOZED    // User snoozed until X time
  DISABLED   // User disabled or auto-disabled due to failures
}
```

---

## Evaluation Engine

### Strategy Pattern (Polling → Event-Driven Migration)

```typescript
interface EvaluationStrategy {
  shouldEvaluate(alert: TokenAlert): boolean;
  evaluate(alert: TokenAlert, data: TokenInfo): Promise<{ triggered: boolean }>;
}

class PollingStrategy implements EvaluationStrategy {
  shouldEvaluate(alert: TokenAlert): boolean {
    // Skip if not in active state
    if (alert.state !== 'ACTIVE') return false;

    // Skip if snoozed
    if (alert.snoozedUntil && alert.snoozedUntil > new Date()) return false;

    // Check active hours (e.g., only 9am-5pm)
    if (alert.activeHoursUtc) {
      const now = new Date().getUTCHours();
      const { start, end } = alert.activeHoursUtc;
      if (now < start || now > end) return false;
    }

    // Check cooldown
    if (alert.lastTriggeredAt) {
      const cooldownMs = alert.cooldownMinutes * 60 * 1000;
      const timeSinceTrigger = Date.now() - alert.lastTriggeredAt.getTime();
      if (timeSinceTrigger < cooldownMs) return false;
    }

    return true;
  }

  async evaluate(alert: TokenAlert, data: TokenInfo): Promise<{ triggered: boolean }> {
    const conditions = alert.conditions as any;

    // Support composite logic
    if (conditions.operator === 'AND') {
      const results = await Promise.all(conditions.rules.map(r => this.evalRule(r, data)));
      return { triggered: results.every(Boolean) };
    } else if (conditions.operator === 'OR') {
      const results = await Promise.all(conditions.rules.map(r => this.evalRule(r, data)));
      return { triggered: results.some(Boolean) };
    } else {
      // Single condition (backwards compatible)
      return { triggered: await this.evalRule(conditions, data) };
    }
  }

  private async evalRule(rule: any, data: any): Promise<boolean> {
    const value = this.extractValue(rule.field, data);

    switch (rule.type) {
      case 'price':
        return this.compare(value, rule.operator, rule.value);

      case 'price_change':
        // Calculate % change vs baseline
        const timeframeField = `${rule.field}_${rule.timeframe}_ago`;
        const baseline = data[timeframeField];
        if (!baseline) return false;
        const change = ((value - baseline) / baseline) * 100;
        return this.compare(Math.abs(change), rule.operator, rule.value);

      case 'volume':
        return this.compare(value, rule.operator, rule.value);

      case 'liquidity':
        return this.compare(value, rule.operator, rule.value);

      default:
        return false;
    }
  }

  private extractValue(field: string, data: any): number {
    // Support nested fields: "metrics.volume24h"
    return field.split('.').reduce((obj, key) => obj?.[key], data);
  }

  private compare(a: number, op: string, b: number): boolean {
    switch (op) {
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'eq': return a === b;
      default: return false;
    }
  }
}

// Future: Event-driven strategy
class EventDrivenStrategy implements EvaluationStrategy {
  // Only evaluates when relevant events occur (price update, new message, etc.)
  // More efficient at scale, but requires event infrastructure
}
```

### Background Job

```typescript
@Injectable()
export class AlertEvaluatorJob {
  constructor(
    @Inject('ALERT_STRATEGY') private readonly strategy: EvaluationStrategy,
    private readonly db: DatabaseService,
    private readonly alertService: AlertsService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes (configurable via env)
  async run() {
    const startTime = Date.now();

    try {
      // Fetch alerts in priority order
      const alerts = await this.db.tokenAlert.findMany({
        where: { isActive: true, state: 'ACTIVE' },
        orderBy: [
          { priority: 'desc' },      // CRITICAL alerts first
          { lastEvaluatedAt: 'asc' } // Oldest evaluations first
        ],
        take: 500, // Max 500 per tick (prevent runaway)
        include: { TokenInfo: true }
      });

      // Group by token for efficient batch processing
      const byToken = this.groupBy(alerts, 'tokenAddress');
      const results = { triggered: 0, evaluated: 0, failed: 0 };

      for (const [tokenAddress, tokenAlerts] of Object.entries(byToken)) {
        try {
          let currentData = tokenAlerts[0].TokenInfo;

          // Auto-enrich if data is stale (older than 10 min)
          if (this.isStale(currentData)) {
            await this.tokenInfoService.enrichToken(tokenAddress);
            currentData = await this.db.tokenInfo.findUnique({
              where: { tokenAddress }
            });
          }

          for (const alert of tokenAlerts) {
            if (!this.strategy.shouldEvaluate(alert)) continue;

            try {
              const result = await this.strategy.evaluate(alert, currentData);
              results.evaluated++;

              // Update evaluation metadata
              await this.db.tokenAlert.update({
                where: { id: alert.id },
                data: {
                  lastEvaluatedAt: new Date(),
                  evaluationCount: { increment: 1 }
                }
              });

              if (result.triggered) {
                await this.alertService.trigger(alert, currentData);
                results.triggered++;
              }
            } catch (error) {
              results.failed++;
              await this.handleEvaluationError(alert, error);
            }
          }
        } catch (error) {
          this.logger.error(`Token batch evaluation failed for ${tokenAddress}:`, error);
        }
      }

      // Record metrics
      const duration = Date.now() - startTime;
      this.metrics.record('alert_evaluator', {
        duration,
        evaluated: results.evaluated,
        triggered: results.triggered,
        failed: results.failed,
      });

      this.logger.log(
        `Alert evaluation: ${results.evaluated} evaluated, ` +
        `${results.triggered} triggered, ${results.failed} failed in ${duration}ms`
      );

    } catch (error) {
      this.logger.error('Alert evaluator job failed:', error);
      this.metrics.increment('alert_evaluator_job_failure');
    }
  }

  private isStale(data: TokenInfo): boolean {
    if (!data.updatedAt) return true;
    const ageMinutes = (Date.now() - data.updatedAt.getTime()) / 60000;
    return ageMinutes > 10; // Stale if older than 10 minutes
  }

  private async handleEvaluationError(alert: TokenAlert, error: any) {
    await this.db.tokenAlert.update({
      where: { id: alert.id },
      data: {
        failureCount: { increment: 1 },
        lastError: String(error?.message ?? error).slice(0, 255)
      }
    });

    // Auto-disable after 10 consecutive failures
    if (alert.failureCount + 1 >= 10) {
      await this.db.tokenAlert.update({
        where: { id: alert.id },
        data: {
          isActive: false,
          state: 'DISABLED'
        }
      });

      // Notify user their alert was disabled
      await this.alertService.notifyUserOfDisabledAlert(alert, error);
    }
  }

  private groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
    return items.reduce((acc, item) => {
      const group = String(item[key]);
      acc[group] = acc[group] || [];
      acc[group].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  }
}
```

---

## Delivery Service

### Smart Grouping (Prevents Spam)

```typescript
@Injectable()
export class AlertDeliveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly socketGateway: MessageGateway,
    private readonly webPushService: WebPushService,
    private readonly telegramService: TelegramService,
  ) {}

  async sendOrGroup(notification: AlertNotification, alert: TokenAlert) {
    // Check if there are recent notifications in the same group
    const recentInGroup = await this.db.alertNotification.count({
      where: {
        groupKey: notification.groupKey,
        triggeredAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 min
        id: { not: notification.id }
      }
    });

    if (recentInGroup >= 2) {
      // Group into single notification: "3 alerts triggered for BONK"
      await this.sendGroupedNotification(notification.groupKey, notification.userId);
    } else {
      // Send individual notification
      await this.sendIndividual(notification, alert);
    }
  }

  private async sendIndividual(notification: AlertNotification, alert: TokenAlert) {
    const channels = alert.channels as string[];
    const deliveryStatus: any = {};

    // In-app notification (socket broadcast)
    if (channels.includes('in_app')) {
      try {
        this.socketGateway.emitToUser(alert.userId, 'alert.triggered', {
          id: notification.id,
          alert,
          snapshot: notification.snapshot
        });
        deliveryStatus.in_app = { status: 'sent', sentAt: new Date().toISOString() };
      } catch (error) {
        deliveryStatus.in_app = { status: 'failed', error: String(error) };
      }
    }

    // Browser push notification
    if (channels.includes('browser_push')) {
      try {
        await this.webPushService.send(alert.userId, {
          title: alert.label || 'Token Alert',
          body: this.formatMessage(alert, notification.snapshot),
          data: {
            alertId: alert.id,
            tokenAddress: alert.tokenAddress,
            notificationId: notification.id
          }
        });
        deliveryStatus.browser_push = { status: 'delivered', deliveredAt: new Date().toISOString() };
      } catch (error) {
        deliveryStatus.browser_push = { status: 'failed', error: String(error) };
      }
    }

    // Telegram notification
    if (channels.includes('telegram')) {
      try {
        const telegramId = await this.getUserTelegramId(alert.userId);
        if (telegramId) {
          await this.telegramService.sendMessage(
            telegramId,
            this.formatMessage(alert, notification.snapshot)
          );
          deliveryStatus.telegram = { status: 'delivered', deliveredAt: new Date().toISOString() };
        } else {
          deliveryStatus.telegram = { status: 'failed', error: 'Telegram not connected' };
        }
      } catch (error) {
        deliveryStatus.telegram = { status: 'failed', error: String(error) };
      }
    }

    // Update notification with delivery status
    await this.db.alertNotification.update({
      where: { id: notification.id },
      data: { channels: deliveryStatus }
    });
  }

  private async sendGroupedNotification(groupKey: string, userId: string) {
    const notifications = await this.db.alertNotification.findMany({
      where: { groupKey, userId },
      include: { Alert: { include: { TokenInfo: true } } }
    });

    const tokenAddress = notifications[0].Alert.tokenAddress;
    const symbol = notifications[0].Alert.TokenInfo?.symbol || tokenAddress.slice(0, 6);

    // Send single grouped notification
    this.socketGateway.emitToUser(userId, 'alert.grouped', {
      count: notifications.length,
      tokenAddress,
      symbol,
      notifications: notifications.map(n => ({
        id: n.id,
        label: n.Alert.label,
        triggeredAt: n.triggeredAt,
        snapshot: n.snapshot
      }))
    });
  }

  private formatMessage(alert: TokenAlert, snapshot: any): string {
    const symbol = snapshot.symbol || alert.tokenAddress.slice(0, 6);

    if (alert.conditions.type === 'price') {
      const emoji = alert.conditions.operator === 'gt' ? '🚀' : '📉';
      return `${emoji} ${symbol} price: $${snapshot.priceUsd}`;
    }

    if (alert.conditions.type === 'price_change') {
      return `📊 ${symbol} ${snapshot.change24h > 0 ? '+' : ''}${snapshot.change24h.toFixed(1)}% in ${alert.conditions.timeframe}`;
    }

    if (alert.conditions.type === 'new_message') {
      return `💬 New message in ${symbol} thread`;
    }

    return `🔔 ${alert.label || 'Alert triggered'} for ${symbol}`;
  }

  private async getUserTelegramId(userId: string): Promise<string | null> {
    // Fetch from User table or TelegramConnection table
    const user = await this.db.user.findUnique({ where: { id: userId } });
    return user?.telegramId || null;
  }
}
```

---

## API Endpoints

### Alert Management

```typescript
// POST /api/v1/alerts
// Create new alert
{
  "tokenAddress": "So11111111111111111111111111111111111111112",
  "label": "SOL Moon Alert",
  "conditions": {
    "type": "price",
    "operator": "gt",
    "value": 200,
    "field": "priceUsd"
  },
  "channels": ["in_app", "telegram"],
  "priority": "NORMAL",
  "cooldownMinutes": 60
}

// GET /api/v1/alerts?tokenAddress=...
// List user's alerts (optionally filtered by token)

// PATCH /api/v1/alerts/:id
// Update alert (enable/disable, change conditions, etc.)
{
  "isActive": false,
  "snoozedUntil": "2025-10-04T00:00:00Z"
}

// DELETE /api/v1/alerts/:id
// Delete alert

// POST /api/v1/alerts/:id/test
// Send test notification (verify delivery works)

// GET /api/v1/alerts/:id/history
// Fetch alert trigger history (last 30 days)

// POST /api/v1/alerts/templates/:templateId/use
// Create alert from template

// GET /api/v1/alerts/templates
// List popular templates

// GET /api/v1/notifications?unread=true
// Fetch user's notifications

// PATCH /api/v1/notifications/:id
// Mark notification as read/dismissed
{
  "isRead": true,
  "feedback": "helpful"
}

// POST /api/v1/notifications/:id/feedback
// Provide feedback on notification
{
  "feedback": "too_noisy"
}
```

---

## Frontend Components

### Alert Creator (in Token Drawer)

```tsx
<AlertCreator tokenAddress={tokenAddress}>
  <AlertTypeSelector
    options={[
      { value: 'price_above', label: 'Price goes above', icon: '🚀' },
      { value: 'price_below', label: 'Price goes below', icon: '📉' },
      { value: 'price_change', label: '% change', icon: '📊' },
      { value: 'new_message', label: 'New message', icon: '💬' },
      { value: 'liquidity_drop', label: 'Liquidity drops', icon: '💧' },
    ]}
  />

  {type === 'price_above' && (
    <NumberInput
      label="Target Price"
      placeholder="0.00001"
      step="0.000001"
      value={targetPrice}
      onChange={setTargetPrice}
    />
  )}

  {type === 'price_change' && (
    <>
      <NumberInput label="% Change" placeholder="20" value={changePercent} />
      <Select label="Timeframe">
        <option value="15m">15 minutes</option>
        <option value="1h">1 hour</option>
        <option value="4h">4 hours</option>
        <option value="24h">24 hours</option>
      </Select>
    </>
  )}

  <CheckboxGroup label="Notify via">
    <Checkbox value="in_app" defaultChecked>In-app</Checkbox>
    <Checkbox value="browser_push">Browser push</Checkbox>
    <Checkbox value="telegram">Telegram</Checkbox>
  </CheckboxGroup>

  <Select label="Priority">
    <option value="NORMAL">Normal</option>
    <option value="CRITICAL">Critical (always notify)</option>
    <option value="INFO">Low priority (can batch)</option>
  </Select>

  <NumberInput
    label="Cooldown (minutes)"
    defaultValue={60}
    min={5}
    max={1440}
  />

  <Collapsible label="Advanced">
    <TimeRangeSelector label="Active hours" />
    <Select label="Mode">
      <option value="RECURRING">Keep alerting</option>
      <option value="ONE_SHOT">Alert once then disable</option>
    </Select>
  </Collapsible>

  <div className="flex gap-2">
    <Button variant="outline" onClick={testAlert}>Test Alert</Button>
    <Button onClick={createAlert}>Create Alert</Button>
  </div>
</AlertCreator>
```

### Alert Feed (Sidebar/Notifications Panel)

```tsx
<AlertFeed>
  <div className="flex items-center justify-between p-3 border-b">
    <h3 className="font-semibold">Notifications</h3>
    <Badge>{unreadCount}</Badge>
  </div>

  {notifications.map(n => (
    <NotificationCard
      key={n.id}
      unread={!n.isRead}
      priority={n.Alert.priority}
    >
      <TokenBadge mint={n.Alert.tokenAddress} size="sm" />

      <div className="flex-1">
        <strong>{n.Alert.label}</strong>
        <p className="text-sm text-muted-foreground">
          {formatSnapshot(n.snapshot)}
        </p>
        <time className="text-xs text-muted-foreground">
          {formatRelative(n.triggeredAt)}
        </time>
      </div>

      <DropdownMenu>
        <DropdownMenuItem onClick={() => markRead(n.id)}>
          Mark as read
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dismiss(n.id)}>
          Dismiss
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => feedback(n.id, 'helpful')}>
          👍 Helpful
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => feedback(n.id, 'too_noisy')}>
          🔇 Too noisy
        </DropdownMenuItem>
      </DropdownMenu>
    </NotificationCard>
  ))}

  {notifications.length === 0 && (
    <EmptyState
      icon="🔔"
      title="No notifications"
      description="Create an alert to get started"
    />
  )}
</AlertFeed>
```

### Alert Management Page

```tsx
<AlertsPage>
  <Tabs>
    <TabsList>
      <TabsTrigger value="active">Active ({activeCoun t})</TabsTrigger>
      <TabsTrigger value="snoozed">Snoozed ({snoozedCount})</TabsTrigger>
      <TabsTrigger value="disabled">Disabled ({disabledCount})</TabsTrigger>
    </TabsList>

    <TabsContent value="active">
      {activeAlerts.map(alert => (
        <AlertRow key={alert.id}>
          <TokenBadge mint={alert.tokenAddress} />
          <div className="flex-1">
            <strong>{alert.label}</strong>
            <p className="text-sm">{formatCondition(alert.conditions)}</p>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>🔔 {alert.triggerCount} triggers</span>
              <span>Last: {formatRelative(alert.lastTriggeredAt)}</span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuItem onClick={() => edit(alert.id)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => snooze(alert.id)}>Snooze</DropdownMenuItem>
            <DropdownMenuItem onClick={() => test(alert.id)}>Test</DropdownMenuItem>
            <DropdownMenuItem onClick={() => viewHistory(alert.id)}>
              View history
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => disable(alert.id)}>
              Disable
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => delete(alert.id)} variant="destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenu>
        </AlertRow>
      ))}
    </TabsContent>
  </Tabs>
</AlertsPage>
```

---

## Implementation Phases

### Phase 1: MVP (1-2 days)
**Goal**: Ship basic price alerts with in-app delivery

- ✅ Database schema (TokenAlert, AlertNotification)
- ✅ Basic CRUD API (create, list, delete alerts)
- ✅ Evaluation engine (polling strategy, price alerts only)
- ✅ In-app delivery (socket broadcast)
- ✅ Simple UI in TokenThread drawer
- ✅ Alert feed with unread count

**Deliverable**: Users can create "Price > $X" alerts and see in-app notifications

---

### Phase 2: Enhancement (2-3 days)
**Goal**: Add more alert types and delivery channels

- ✅ % change alerts (1h, 4h, 24h)
- ✅ Activity alerts (new message in thread)
- ✅ Market alerts (liquidity, volume)
- ✅ Browser push notifications (Web Push API)
- ✅ Telegram delivery integration
- ✅ Cooldown and active hours
- ✅ Alert management page with history

**Deliverable**: Production-ready alerts with multi-channel delivery

---

### Phase 3: Polish (1-2 days)
**Goal**: User experience and reliability improvements

- ✅ Alert templates (popular pre-configured alerts)
- ✅ Smart grouping (prevent spam)
- ✅ Test alert button
- ✅ User feedback loop ("too noisy" → auto-adjust)
- ✅ Composite conditions (AND/OR logic)
- ✅ Priority levels
- ✅ Metrics and observability

**Deliverable**: Polished, user-friendly alerts system

---

### Phase 4: Scale (Optional, 2-3 days)
**Goal**: Handle 10K+ alerts efficiently

- ✅ Event-driven evaluation (migrate from polling)
- ✅ Alert sharding (distribute evaluation across workers)
- ✅ Advanced templates marketplace
- ✅ Cross-token alerts (ratio/spread)
- ✅ Smart alerts (wallet analyzer integration)

**Deliverable**: Scales to power-user workloads

---

## Metrics & Observability

### Key Metrics to Track

```typescript
// Evaluation metrics
alert_evaluator_duration_ms
alert_evaluator_alerts_evaluated
alert_evaluator_alerts_triggered
alert_evaluator_alerts_failed
alert_evaluator_job_failure

// Delivery metrics
alert_delivery_success_rate (by channel)
alert_delivery_latency_ms (by channel)
alert_grouped_notifications_count

// User metrics
alert_creation_rate
alert_trigger_rate_per_user
alert_notification_read_rate
alert_notification_feedback (helpful/noisy/false_positive)

// Health metrics
alert_evaluation_lag_ms (time since last evaluation)
alert_stale_data_percentage
alert_auto_disabled_count
```

### Health Checks

```typescript
// GET /api/v1/health/alerts
{
  "status": "healthy",
  "lastEvaluationAt": "2025-10-03T18:35:00Z",
  "evaluationLagMs": 5000,
  "activeAlertsCount": 1234,
  "failedAlertsLast24h": 12,
  "avgEvaluationTimeMs": 234
}
```

---

## Migration & Feature Flags

### Gradual Rollout

```typescript
// Environment variables
FEATURE_ALERTS_ENABLED=true
FEATURE_ALERTS_EVENT_DRIVEN=false  // Start with polling
FEATURE_ALERTS_SMART_GROUPING=true
FEATURE_ALERTS_TELEGRAM=true
ALERT_EVALUATION_INTERVAL_MINUTES=5
ALERT_MAX_PER_USER=50
ALERT_MAX_BATCH_SIZE=500
```

### Database Migration Strategy

```bash
# 1. Add tables (non-breaking)
npx prisma migrate dev --name add_token_alerts

# 2. Deploy evaluator job (disabled via feature flag)
FEATURE_ALERTS_ENABLED=false

# 3. Enable for beta users
# Update flag in admin panel or env var

# 4. Monitor metrics, adjust evaluation interval

# 5. Full rollout
FEATURE_ALERTS_ENABLED=true
```

---

## Security & Rate Limiting

### User Limits

```typescript
// Per-user quotas
MAX_ALERTS_PER_USER = 50
MAX_ALERTS_PER_TOKEN = 10
MAX_ALERT_CREATIONS_PER_DAY = 20

// Rate limiting
@Post('alerts')
@Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 creations/min
async createAlert() { ... }

// Validation
- Alert conditions must be valid JSON
- Token address must exist in database
- Cooldown must be >= 5 minutes
- Active hours must be valid UTC hours (0-23)
```

---

## Testing Strategy

### Unit Tests
- Condition evaluation logic (all operators, all types)
- Cooldown calculation
- Active hours filtering
- Composite condition logic (AND/OR)

### Integration Tests
- Create alert → trigger → deliver → read flow
- Multi-channel delivery (mock socket/Telegram/email)
- Grouping logic (3 alerts → 1 notification)
- Auto-disable after failures
- Stale data enrichment

### Load Tests
- 10,000 alerts evaluated in <30s
- 1,000 concurrent deliveries
- Database query performance under load

---

## Future Enhancements

### v2 Features
- **Alert marketplace**: Share/sell alert templates
- **Machine learning**: Auto-suggest alert thresholds based on token history
- **Multi-token alerts**: "Alert when BONK/SOL ratio crosses X"
- **Conditional chains**: "If price > $1 then enable secondary alert"
- **WebSocket streaming**: Real-time alert status updates in UI
- **Email digest**: Daily summary of all triggered alerts
- **SMS delivery**: Twilio integration for critical alerts
- **Webhook delivery**: POST to user-provided URL

### Advanced Analytics
- Alert effectiveness score (helpful vs noisy ratio)
- Optimal cooldown suggestions
- Alert fatigue detection (too many alerts → auto-adjust)

---

## Conclusion

This architecture provides:
- ✅ **Reliability**: Retry logic, observability, auto-disable failures
- ✅ **Scalability**: Batched evaluation, migration path to event-driven
- ✅ **Flexibility**: Composite conditions, multiple channels, templates
- ✅ **User Control**: Priority, cooldown, active hours, snooze, feedback
- ✅ **Future-Proof**: Strategy pattern, feature flags, metric-driven

**Start with Phase 1 MVP** (1-2 days) to validate user demand, then iterate based on feedback and metrics.
