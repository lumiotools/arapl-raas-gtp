# Logging System Usage Examples

## Overview
The logging system provides comprehensive operation tracking with millisecond precision timestamps. All operations are stored in the database and can be queried via API endpoints.

## Entity Structure
The Log entity includes:
- **Timestamp**: Millisecond precision for accurate operation tracking
- **Categorization**: LogLevel, LogCategory, OperationType for easy filtering
- **Entity Tracking**: Track operations on specific entities (Task, Order, etc.)
- **Request/Response Data**: Store API request/response payloads
- **Performance Metrics**: Duration tracking for operations
- **Error Handling**: Stack traces and error details
- **Correlation**: Link related operations with correlation_id

## Usage Examples

### 1. Basic Logging in Services

```typescript
import { LoggingService } from '../services/logging.service';
import { LogCategory, OperationType } from '../entities/log.entity';

@Injectable()
export class SomeService {
  constructor(private readonly loggingService: LoggingService) {}

  async createTask(taskData: any) {
    const startTime = Date.now();
    
    try {
      // Create task
      const task = await this.taskRepository.save(taskData);
      
      // Log successful creation
      await this.loggingService.logTaskOperation(
        task.task_id,
        OperationType.CREATE,
        `Task ${task.task_id} created successfully`,
        {
          durationMs: Date.now() - startTime,
          newValues: task,
          sourceModule: 'TaskService',
          sourceFunction: 'createTask'
        }
      );
      
      return task;
    } catch (error) {
      // Log error
      await this.loggingService.error({
        category: LogCategory.TASK,
        operationType: OperationType.CREATE,
        message: `Failed to create task: ${error.message}`,
        errorStack: error.stack,
        requestData: taskData,
        durationMs: Date.now() - startTime,
        sourceModule: 'TaskService',
        sourceFunction: 'createTask'
      });
      
      throw error;
    }
  }
}
```

### 2. API Request Logging in Controllers

```typescript
import { LoggingService } from '../services/logging.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly loggingService: LoggingService) {}

  @Post()
  async createTask(@Body() createTaskDto: any, @Req() req: any) {
    const startTime = Date.now();
    
    try {
      const result = await this.tasksService.create(createTaskDto);
      
      // Log API request
      await this.loggingService.logApiRequest(
        req.route.path,
        req.method,
        200,
        createTaskDto,
        result,
        Date.now() - startTime,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          sessionId: req.sessionID
        }
      );
      
      return result;
    } catch (error) {
      await this.loggingService.logApiRequest(
        req.route.path,
        req.method,
        500,
        createTaskDto,
        { error: error.message },
        Date.now() - startTime,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          errorStack: error.stack
        }
      );
      
      throw error;
    }
  }
}
```

### 3. Entity Update Logging

```typescript
async updateInventory(inventoryId: string, newQuantity: number) {
  const existingInventory = await this.inventoryRepository.findOne({
    where: { inventory_id: inventoryId }
  });
  
  if (!existingInventory) {
    await this.loggingService.warn({
      category: LogCategory.INVENTORY,
      operationType: OperationType.UPDATE,
      message: `Attempted to update non-existent inventory: ${inventoryId}`,
      entityType: 'Inventory',
      entityId: inventoryId
    });
    throw new NotFoundException('Inventory not found');
  }
  
  const oldQuantity = existingInventory.quantity;
  existingInventory.quantity = newQuantity;
  
  const updatedInventory = await this.inventoryRepository.save(existingInventory);
  
  // Log inventory update with before/after values
  await this.loggingService.logInventoryOperation(
    inventoryId,
    OperationType.UPDATE,
    `Inventory ${inventoryId} quantity updated from ${oldQuantity} to ${newQuantity}`,
    oldQuantity,
    newQuantity,
    {
      metadata: {
        difference: newQuantity - oldQuantity,
        updateReason: 'Manual adjustment'
      }
    }
  );
  
  return updatedInventory;
}
```

### 4. Orchestrator Operation Logging

```typescript
async triggerOrchestrator(isManual: boolean = false) {
  const correlationId = `orch-${Date.now()}`;
  
  await this.loggingService.logOrchestratorOperation(
    OperationType.TRIGGER,
    `Orchestrator triggered ${isManual ? 'manually' : 'automatically'}`,
    {
      correlationId,
      metadata: { isManual, triggerTime: new Date() }
    }
  );
  
  try {
    // Process orders
    const processedOrders = await this.processOrders();
    
    await this.loggingService.logOrchestratorOperation(
      OperationType.COMPLETE,
      `Orchestrator completed processing ${processedOrders.length} orders`,
      {
        correlationId,
        metadata: { 
          processedCount: processedOrders.length,
          orderIds: processedOrders.map(o => o.order_id)
        }
      }
    );
    
  } catch (error) {
    await this.loggingService.error({
      category: LogCategory.ORCHESTRATOR,
      operationType: OperationType.ERROR_OCCURRED,
      message: `Orchestrator failed: ${error.message}`,
      correlationId,
      errorStack: error.stack
    });
    
    throw error;
  }
}
```

## API Endpoints

### Get Logs by Entity
```
GET /logs/entity/Task/123?limit=50
```

### Get Logs by Category
```
GET /logs/category/ORCHESTRATOR?limit=100
```

### Get Error Logs
```
GET /logs/errors?limit=50
```

### Get Logs by Time Range
```
GET /logs/time-range?startTime=2024-01-01T00:00:00.000Z&endTime=2024-01-02T00:00:00.000Z&limit=1000
```

## Benefits

1. **Complete Audit Trail**: Every operation is logged with full context
2. **Performance Monitoring**: Duration tracking for all operations
3. **Error Tracking**: Comprehensive error logging with stack traces
4. **Entity Lifecycle**: Track complete lifecycle of entities (Task, Order, etc.)
5. **API Monitoring**: Track all API requests/responses
6. **Correlation**: Link related operations across services
7. **Millisecond Precision**: Accurate timing for debugging race conditions
8. **Searchable**: Query logs by entity, category, operation type, time range

## Database Indexes

The Log entity includes optimized indexes for:
- Timestamp-based queries
- Entity-based lookups
- Category and operation type filtering
- Error log retrieval
- User-based filtering

This ensures fast query performance even with large log volumes.
