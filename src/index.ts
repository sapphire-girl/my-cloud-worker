// src/index.js (续)
import { createSchema, createYoga } from 'graphql-yoga';

// (之前的 typeDefs 和部分 resolvers)

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      hello: String
      greet(name: String): String
      askAI(prompt: String!): String # 新增AI查询
    }
    type Mutation {
      submitMessage(message: String!): String
    }
  `,
  resolvers: {
    Query: {
      hello: () => 'Hello from Cloudflare Worker with GraphQL!',
      greet: (_, { name }) => `Hello, ${name || 'Guest'}!`,
      askAI: async (_, { prompt }, { env }) => { // 'env' 从 yoga.fetch 传递进来
        if (!prompt) {
          return "Please provide a prompt.";
        }

        // 选择一个AI服务 (示例使用DeepSeek)
        const AI_API_KEY = env.DEEPSEEK_API_KEY;
        const AI_API_URL = 'https://api.deepseek.com/chat/completions';

        // 或者 OpenAI
        // const AI_API_KEY = env.OPENAI_API_KEY;
        // const AI_API_URL = 'https://api.openai.com/v1/chat/completions';


        if (!AI_API_KEY) {
          return "AI API Key is not configured in Worker secrets.";
        }

        try {
          const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AI_API_KEY}`,
            },
            body: JSON.stringify({
              // DeepSeek / OpenAI 的请求体结构可能略有不同，请参考各自的API文档
              // 例如 OpenAI:
            //   model: "gpt-3.5-turbo", // 或其他模型如 gpt-4
            //   messages: [{ role: "user", content: prompt }],
              // max_tokens: 150, // 可选

              // 例如 DeepSeek (请核对最新文档):
              model: "deepseek-chat", // 或 "deepseek-coder"
              messages: [{ role: "user", content: prompt }],
            }),
          });

          if (!response.ok) {
            const errorData = await response.text();
            console.error('AI API Error:', response.status, errorData);
            return `Error from AI API: ${response.status} - ${errorData}`;
          }

          const data = await response.json();

          // 提取回复 (结构也因服务而异)
          // 例如 OpenAI:
        //   return data.choices[0]?.message?.content?.trim() || "No response content.";
          // 例如 DeepSeek (请核对最新文档):
          return data.choices[0]?.message?.content?.trim() || "No response content.";

        } catch (error) {
          console.error('Error calling AI API:', error);
          return 'Failed to get response from AI.';
        }
      },
    },
    Mutation: {
        submitMessage: (_, { message }) => {
          console.log('Received message:', message);
          return `Message received: "${message}"`;
        }
      }
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/', // Worker将在此路径下处理GraphQL请求
  // context: (initialContext) => ({ // 如果你需要显式传递env给resolver
  //   env: initialContext.request.env, // 这种方式 yoga 会自动处理
  // })
});

export default {
  async fetch(request, env, ctx) {
    // yoga.fetch 的第二个参数可以是 context 对象，它会自动包含 env
    return yoga.fetch(request, env, ctx);
  },
};