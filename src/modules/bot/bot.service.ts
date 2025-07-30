import { Injectable } from '@nestjs/common';
import { BotRequest } from './bot.controller';
import { BotResponse } from './bot.controller';
import OpenAI from "openai";
import { ChatCompletionCreateParams, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Tools, ToolService } from './tools';

const openai = new OpenAI({ 
    apiKey: process.env.BOT_API_KEY // or process.env.OPENAI_API_KEY
});
const MODEL = 'gpt-4o-mini'; // or 'gpt-4', 'gpt-3.5-turbo', etc.

@Injectable()
export class BotService {
    constructor(private readonly toolService: ToolService) {}

    async processRequest(body: BotRequest): Promise<BotResponse> {
        const query = body.query;
        const chatHistory = body.chat_history || [];
        const messages: ChatCompletionMessageParam[] = [];
        
        messages.push({
            role: 'system',
            content: 'You are a helpful assistant that uses tools to assist users. Info: GTP locations and Pick locations are same.',
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

        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: messages,
            tools: Tools,
            stream: false,
            tool_choice: 'auto',
            max_tokens: 1000,
            temperature: 0.3,
        });
        
        const responseMessage = response.choices[0].message;
        const toolCalls = response.choices[0].message.tool_calls;

        if (toolCalls) {
            const availableFunctions = {
                "getAllInventory": this.toolService.getAllInventory.bind(this.toolService),
                "getAllProducts": this.toolService.getAllProducts.bind(this.toolService),
                "getOrderItems": this.toolService.getOrderItems.bind(this.toolService),
                "getStations": this.toolService.getStations.bind(this.toolService),
                "getPickLocations": this.toolService.getPickLocations.bind(this.toolService),
                "getStationFromPickLocation": this.toolService.getStationFromPickLocation.bind(this.toolService),
                "getPickLocationFromStation": this.toolService.getPickLocationFromStation.bind(this.toolService),
                "getLicensePlateNumberRequirement": this.toolService.getLicensePlateNumberRequirement.bind(this.toolService),
                "getLicensePlateNumberInitialRequirement": this.toolService.getLicensePlateNumberInitialRequirement.bind(this.toolService),
                "getOrderItemAssignedToPickLocation": this.toolService.getOrderItemAssignedToPickLocation.bind(this.toolService),
                "getWaitingLocations": this.toolService.getWaitingLocations.bind(this.toolService),
                "getContext": this.toolService.getContext.bind(this.toolService),
            };

            // Add the assistant's message with tool calls
            messages.push(responseMessage);

            // Process each tool call
            for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                const functionToCall = availableFunctions[functionName];
                
                if (!functionToCall) {
                    continue;
                }

                try {
                    let functionResponse;
                    
                    // Check which functions don't need arguments
                    const functionsWithoutArgs = [
                        'getAllInventory', 
                        'getAllProducts', 
                        'getOrderItems',
                        'getStations', 
                        'getPickLocations',
                        'getWaitingLocations'
                    ];
                    
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
                    const toolMessage: ChatCompletionMessageParam = {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: typeof functionResponse === 'string' ? functionResponse : JSON.stringify(functionResponse),
                    };
                    
                    messages.push(toolMessage);
                } catch (error) {
                    // Handle function execution errors
                    const errorMessage: ChatCompletionMessageParam = {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: `Error executing function ${functionName}: ${error.message}`,
                    };
                    
                    messages.push(errorMessage);
                }
            }

            // Get the final response
            const secondResponse = await openai.chat.completions.create({
                model: MODEL,
                messages: messages
            });
            
            if (!secondResponse.choices || secondResponse.choices.length === 0 || !secondResponse.choices[0].message || !secondResponse.choices[0].message.content) {
                throw new Error('No response from OpenAI');
            }
            
            console.log(`tool calls: ${JSON.stringify(toolCalls)}`);
            return { response: secondResponse.choices[0].message.content };
        }
        
        if (!responseMessage || !responseMessage.content) {
            throw new Error('No response from OpenAI');
        }
        
        return { response: responseMessage.content };
    }
}