import { Injectable } from '@nestjs/common';
import { BotRequest } from './bot.controller';
import { BotResponse } from './bot.controller';
import Groq from "groq-sdk";
import OpenAI from "openai";
import { ChatCompletionCreateParams, ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { ChatCompletionCreateParams as OpenAIChatCompletionCreateParams, ChatCompletionMessageParam as OpenAIChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { Tools, ToolService } from './tools';

// Configuration based on environment variables
const isOpenAI = process.env.IS_OPENAI === 'false' ? false : true;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || (isOpenAI ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile');
// Initialize clients
let groqClient: Groq | null = null;
let openaiClient: OpenAI | null = null;
console.log(`Using ${isOpenAI ? 'OpenAI' : 'Groq'} with model: ${model}`);
if (isOpenAI) {
    openaiClient = new OpenAI({
        apiKey: apiKey
    });
} else {
    groqClient = new Groq({
        apiKey: apiKey
    });
}

@Injectable()
export class BotService {
    constructor(private readonly toolService: ToolService) {}

    async processRequest(body: BotRequest): Promise<BotResponse> {
    const query = body.query;
    const chatHistory = body.chat_history || [];
    
    // Use unified message type (both libraries have compatible interfaces)
    const messages: (ChatCompletionMessageParam | OpenAIChatCompletionMessageParam)[] = [];
    
    messages.push({
        role: 'system',
        content: `You are a helpful assistant that uses tool calls to answer user queries. 
        Info: 
        1. GTP locations are also named as pallet slots or pick locations. 
        2. Empty Locations (Empty Pallets) has nothing to do with status = Available or Occupied. Empty Locations are just a category of locations that are designated for storing empty pallets. For finding inventories/quarantine at empty location/pallet or empty inventories, find all the inventory then check is_empty = true. Don't mention inventory.status in the response.
        3. For Quarantine Location, fetch all inventories with is_quarantine = true.
        4. Mention location_name (not id) while referring to a location (inventory/quarantine/station/empty locations) in the response.
        5. To check if the pallet is present at the inventory/quarantine location, use the field barcode_number. If null, then no pallet is present.
        6. Orders.source_location_id -> Inventory.location_id. Orders.destionation_pallet_slot_id -> gtp_locations.id.
        7. Gtp location.station_id -> station.station_id.
        8. task.origin_location -> inventory.location_id. Tasks and Orders are different entities. Tasks are created to fulfill orders.
        9. Don't mention the internal states like tool calls, attributes, function names etc. in the final response. User don't need it.
        10. Provide responses in simple text, no tables
        `,
    });
    
    for (const history of chatHistory) {
        messages.push({
            role: history.role,
            content: history.content,
        });
    }
    
    messages.push({
        role: 'user',
        content: query,
    });

    console.log(`messages: ${JSON.stringify(messages)}`);

    // Available functions mapping
    const availableFunctions = {
        "orderStats": this.toolService.orderStats.bind(this.toolService),
        "getStations": this.toolService.getStations.bind(this.toolService),
        "getPickLocations": this.toolService.getPickLocations.bind(this.toolService),
        "getStationFromPickLocation": this.toolService.getStationFromPickLocation.bind(this.toolService),
        "getPickLocationFromStation": this.toolService.getPickLocationFromStation.bind(this.toolService),
        "getWaitingLocations": this.toolService.getWaitingLocations.bind(this.toolService),
        "getContext": this.toolService.getContext.bind(this.toolService),
        "getEmptyLocations": this.toolService.getEmptyLocations.bind(this.toolService),
        "getInventories": this.toolService.getInventories.bind(this.toolService),
        "convertUtcToLocal": this.toolService.convertUtcToLocal.bind(this.toolService),
        "getLocalTime": this.toolService.getLocalTime.bind(this.toolService),
        "taskStats": this.toolService.taskStats.bind(this.toolService),
        "ordersByTimeRange": this.toolService.ordersByTimeRange.bind(this.toolService),
        "tasksByTimeRange": this.toolService.tasksByTimeRange.bind(this.toolService),
        "getRobots": this.toolService.getRobots.bind(this.toolService),
        "settings": this.toolService.settings.bind(this.toolService),
    };

    // Functions that don't need arguments
    const functionsWithoutArgs = [
        'getAllInventory', 
        'getAllProducts',
        'getStations', 
        'getPickLocations',
        'getWaitingLocations',
        'getEmptyLocations',
        'getInventories',
        'getLocalTime',
        'taskStats',
        'getRobots',
        'settings'
    ];

    // Make the initial completion call
    let response: any;
    
    if (isOpenAI && openaiClient) {
        response = await openaiClient.chat.completions.create({
            model: model,
            messages: messages as OpenAIChatCompletionMessageParam[],
            tools: Tools,
            tool_choice: 'auto',
            max_tokens: 1000,
            temperature: 0.3,
        });
    } else if (groqClient) {
        response = await groqClient.chat.completions.create({
            model: model,
            messages: messages as ChatCompletionMessageParam[],
            tools: Tools,
            stream: false,
            tool_choice: 'auto',
            max_tokens: 1000,
            temperature: 0.3,
        });
    } else {
        throw new Error('No valid client configured');
    }

    // Loop to handle multiple rounds of tool calling
    let maxIterations = 5;
    let iteration = 0;

    while (response.choices[0].message.tool_calls && iteration < maxIterations) {
        iteration++;
        console.log(`Tool calling iteration: ${iteration}`);
        
        const responseMessage = response.choices[0].message;
        const toolCalls = response.choices[0].message.tool_calls;

        // Add the assistant's message with tool calls
        messages.push(responseMessage);

        // Process each tool call
        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;
            const functionToCall = availableFunctions[functionName];
            
            if (!functionToCall) {
                console.warn(`Function ${functionName} not found`);
                continue;
            }

            try {
                let functionResponse;
                
                if (functionsWithoutArgs.includes(functionName)) {
                    // These functions don't need arguments
                    functionResponse = await functionToCall();
                } else {
                    // Functions that need arguments
                    if (toolCall.function.arguments) {
                        const functionArgs = JSON.parse(toolCall.function.arguments);
                        functionResponse = await functionToCall(functionArgs);    
                    } else {
                        throw new Error(`Function ${functionName} requires arguments but none provided`);
                    }
                }
                
                // Ensure the content is a string
                const toolMessage: ChatCompletionMessageParam | OpenAIChatCompletionMessageParam = {
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: typeof functionResponse === 'string' ? functionResponse : JSON.stringify(functionResponse),
                };
                
                messages.push(toolMessage);
            } catch (error) {
                // Handle function execution errors
                console.error(`Error executing function ${functionName}:`, error);
                const errorMessage: ChatCompletionMessageParam | OpenAIChatCompletionMessageParam = {
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: `Error executing function ${functionName}: ${error.message}`,
                };
                
                messages.push(errorMessage);
            }
        }

        // Make another completion call with the tool results
        if (isOpenAI && openaiClient) {
            response = await openaiClient.chat.completions.create({
                model: model,
                messages: messages as OpenAIChatCompletionMessageParam[],
                tools: Tools,
                tool_choice: 'auto',
                max_tokens: 1000,
                temperature: 0.3,
            });
        } else if (groqClient) {
            response = await groqClient.chat.completions.create({
                model: model,
                messages: messages as ChatCompletionMessageParam[],
                tools: Tools,
                stream: false,
                tool_choice: 'auto',
                max_tokens: 1000,
                temperature: 0.3,
            });
        } else {
            throw new Error('No valid client configured');
        }

        console.log(`Iteration ${iteration} completed. Has tool calls: ${!!response.choices[0].message.tool_calls}`);
    }

    // Check if we have a valid final response
    const finalMessage = response.choices[0]?.message;
    
    if (!finalMessage) {
        throw new Error(`No valid response from ${isOpenAI ? 'OpenAI' : 'Groq'}`);
    }

    // Log final response for debugging
    console.log('Final response content:', finalMessage.content);
    console.log('Final response has tool_calls:', !!finalMessage.tool_calls);

    // If still has tool_calls after max iterations, warn but return what we have
    if (finalMessage.tool_calls && iteration >= maxIterations) {
        console.warn('Max iterations reached but still has tool calls');
    }

    // Return the content or a default message
    return { 
        response: finalMessage.content || "I'm sorry, I couldn't generate a response at this time." 
    };
}
}