import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Batch, BatchStatus } from 'src/entities/batch.entity';

interface HeapItem {
  data: string;
  priority: number;
}

@Injectable()
export class HeapPriorityQueueService implements OnModuleInit {
  private readonly logger = new Logger(HeapPriorityQueueService.name);
  private heap: HeapItem[] = [];

  @InjectRepository(Batch)
  private readonly batchRepository: Repository<Batch>;

  async onModuleInit() {
    this.logger.log('Initializing Heap Priority Queue...');
    await this.initializeQueue();
  }

  private async initializeQueue() {
    // const pending_batches = await this.batchRepository.find({ where: {status: In([BatchStatus.PENDING])} });
    // for (const batch of pending_batches) {
    //   this.enqueue(batch.batch_id, batch.priority);
    // }
    // this.logger.log(`Priority Queue initialized with ${this.size()} pending batches`);
  }

  enqueue(item: string, priority: number): void {
    const heapItem: HeapItem = { data: item, priority };
    this.heap.push(heapItem);
    this.heapifyUp(this.heap.length - 1);
    this.logger.debug(`Enqueued batch: ${item} with priority: ${priority}`);
  }

  dequeue(): string | null {
    if (this.heap.length === 0) return null;
    
    if (this.heap.length === 1) {
      const item = this.heap.pop()!.data;
      this.logger.debug(`Dequeued batch: ${item}`);
      return item;
    }

    const root = this.heap[0].data;
    this.heap[0] = this.heap.pop()!;
    this.heapifyDown(0);
    this.logger.debug(`Dequeued batch: ${root}`);
    return root;
  }

  peek(): string | null {
    return this.heap.length > 0 ? this.heap[0].data : null;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  size(): number {
    return this.heap.length;
  }

  private heapifyUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      
      if (this.heap[parentIndex].priority <= this.heap[index].priority) {
        break;
      }
      
      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private heapifyDown(index: number): void {
    while (true) {
      let minIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < this.heap.length && 
          this.heap[leftChild].priority < this.heap[minIndex].priority) {
        minIndex = leftChild;
      }

      if (rightChild < this.heap.length && 
          this.heap[rightChild].priority < this.heap[minIndex].priority) {
        minIndex = rightChild;
      }

      if (minIndex === index) break;

      [this.heap[index], this.heap[minIndex]] = [this.heap[minIndex], this.heap[index]];
      index = minIndex;
    }
  }

  // Additional utility methods
  clear(): void {
    this.heap = [];
    this.logger.log('Priority queue cleared');
  }

  toArray(): HeapItem[] {
    return [...this.heap];
  }

  // New enhanced methods for your use case

  /**
   * Check if a specific batch exists in the queue
   */
  contains(batchId: string): boolean {
    return this.heap.some(item => item.data === batchId);
  }

  /**
   * Remove a specific batch from the queue
   */
  remove(batchId: string): boolean {
    const index = this.heap.findIndex(item => item.data === batchId);
    if (index === -1) return false;

    // Replace with last element and heapify
    const lastItem = this.heap.pop()!;
    if (index < this.heap.length) {
      this.heap[index] = lastItem;
      // Try heapifying both up and down
      this.heapifyUp(index);
      this.heapifyDown(index);
    }
    
    this.logger.debug(`Removed batch: ${batchId} from queue`);
    return true;
  }

  /**
   * Update priority of an existing batch
   */
  updatePriority(batchId: string, newPriority: number): boolean {
    const index = this.heap.findIndex(item => item.data === batchId);
    if (index === -1) return false;

    const oldPriority = this.heap[index].priority;
    this.heap[index].priority = newPriority;

    // Heapify based on priority change
    if (newPriority < oldPriority) {
      this.heapifyUp(index);
    } else if (newPriority > oldPriority) {
      this.heapifyDown(index);
    }

    this.logger.debug(`Updated priority for batch: ${batchId} from ${oldPriority} to ${newPriority}`);
    return true;
  }

  /**
   * Add a new batch from database (useful when new batches are created)
   */
  async addPendingBatch(batchId: string): Promise<boolean> {
    const batch = await this.batchRepository.findOne({ 
      where: { batch_id: batchId, status: BatchStatus.PENDING } 
    });
    
    if (!batch) {
      this.logger.warn(`Batch not found or not pending: ${batchId}`);
      return false;
    }

    if (this.contains(batchId)) {
      this.logger.warn(`Batch already in queue: ${batchId}`);
      return false;
    }

    this.enqueue(batch.batch_id, batch.priority);
    return true;
  }

  /**
   * Refresh queue from database (useful for periodic sync)
   */
  async refreshFromDatabase(): Promise<void> {
    this.logger.log('Refreshing priority queue from database...');
    
    const pending_batches = await this.batchRepository.find({ 
      where: { status: BatchStatus.PENDING } 
    });
    
    // Clear existing queue
    this.clear();
    
    // Re-populate from database
    pending_batches.forEach(batch => {
      this.enqueue(batch.batch_id, batch.priority);
    });
    
    this.logger.log(`Queue refreshed with ${this.size()} pending batches`);
  }

  /**
   * Get batches by priority level
   */
  getBatchesByPriority(priority: number): string[] {
    return this.heap
      .filter(item => item.priority === priority)
      .map(item => item.data);
  }

  /**
   * Get next N batches without removing them
   */
  peekNext(count: number): string[] {
    if (count <= 0 || this.heap.length === 0) return [];
    
    // Create a copy of heap and extract top N items
    const tempHeap = [...this.heap];
    const result: string[] = [];
    
    for (let i = 0; i < count && tempHeap.length > 0; i++) {
      // Get minimum element
      result.push(tempHeap[0].data);
      
      // Remove minimum and re-heapify
      if (tempHeap.length === 1) {
        tempHeap.pop();
      } else {
        tempHeap[0] = tempHeap.pop()!;
        this.heapifyDownArray(tempHeap, 0);
      }
    }
    
    return result;
  }

  /**
   * Helper method for peekNext
   */
  private heapifyDownArray(arr: HeapItem[], index: number): void {
    while (true) {
      let minIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < arr.length && arr[leftChild].priority < arr[minIndex].priority) {
        minIndex = leftChild;
      }

      if (rightChild < arr.length && arr[rightChild].priority < arr[minIndex].priority) {
        minIndex = rightChild;
      }

      if (minIndex === index) break;

      [arr[index], arr[minIndex]] = [arr[minIndex], arr[index]];
      index = minIndex;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    totalBatches: number;
    isEmpty: boolean;
    highestPriority: number | null;
    lowestPriority: number | null;
    averagePriority: number | null;
  } {
    if (this.heap.length === 0) {
      return {
        totalBatches: 0,
        isEmpty: true,
        highestPriority: null,
        lowestPriority: null,
        averagePriority: null
      };
    }

    const priorities = this.heap.map(item => item.priority);
    const sum = priorities.reduce((a, b) => a + b, 0);

    return {
      totalBatches: this.heap.length,
      isEmpty: false,
      highestPriority: Math.min(...priorities), // Lower number = higher priority
      lowestPriority: Math.max(...priorities),
      averagePriority: sum / priorities.length
    };
  }

  /**
   * Validate heap property (for debugging)
   */
  validateHeap(): boolean {
    for (let i = 0; i < this.heap.length; i++) {
      const leftChild = 2 * i + 1;
      const rightChild = 2 * i + 2;

      if (leftChild < this.heap.length && this.heap[i].priority > this.heap[leftChild].priority) {
        this.logger.error(`Heap property violated at index ${i} and left child ${leftChild}`);
        return false;
      }

      if (rightChild < this.heap.length && this.heap[i].priority > this.heap[rightChild].priority) {
        this.logger.error(`Heap property violated at index ${i} and right child ${rightChild}`);
        return false;
      }
    }
    return true;
  }
}