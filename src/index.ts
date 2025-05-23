// 定义环境变量的类型 (用于 Worker Secrets)
interface Env {
	GEMINI_API_KEY: string; // 我们将确保此密钥存在，否则会抛出错误
	// 如果有其他环境变量或绑定，可以在这里添加
  }
  
  // 定义从前端接收的请求体类型
  interface FrontendRequestBody {
	message: string;
  }
  
  // Gemini API 请求体中的 part 结构
  interface GeminiPart {
	text: string;
  }
  
  // Gemini API 请求体中的 content 结构
  interface GeminiContent {
	parts: GeminiPart[];
	role?: string; // 可选的角色，例如 "model"
  }
  
  // Gemini API 响应中的 candidate 结构
  interface GeminiCandidate {
	content: GeminiContent;
	finishReason?: string; // 例如: "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER"
	index?: number;
	safetyRatings?: GeminiSafetyRating[]; // 可选的安全评级
  }
  
  // Gemini API 的安全评级结构
  interface GeminiSafetyRating {
	category: string; // 例如: "HARM_CATEGORY_HARASSMENT"
	probability: string; // 例如: "NEGLIGIBLE", "LOW", "MEDIUM", "HIGH"
	blocked?: boolean; // 可选，指示此评级是否导致阻止
  }
  
  // Gemini API 的提示反馈结构
  interface GeminiPromptFeedback {
	blockReason?: string; // 例如: "SAFETY", "OTHER"
	safetyRatings?: GeminiSafetyRating[];
  }
  
  // Gemini API 响应的整体结构
  interface GeminiApiResponse {
	candidates?: GeminiCandidate[];
	promptFeedback?: GeminiPromptFeedback;
  }
  
  // 发送给 Gemini API 的请求体类型
  interface GeminiRequestBody {
	contents: Array<{
	  parts: Array<{ text: string }>;
	}>;
	generationConfig?: {
	  temperature?: number;
	  topK?: number;
	  topP?: number;
	  maxOutputTokens?: number;
	  candidateCount?: number; // 通常为 1
	};
	safetySettings?: Array<{
	  category: string; // 例如: "HARM_CATEGORY_HARASSMENT"
	  threshold: string; // 例如: "BLOCK_MEDIUM_AND_ABOVE"
	}>;
  }
  
  // Worker 返回给前端的错误响应类型
  interface WorkerErrorResponse {
	error: string;
	details?: any;
  }
  
  // Worker 返回给前端的成功响应类型
  interface WorkerSuccessResponse {
	reply: string;
  }
  
  // Cloudflare Worker fetch 处理函数
  export default {
	async fetch(
	  request: Request, // Request 对象类型
	  env: Env,         // 环境变量对象类型
	  ctx: ExecutionContext // 执行上下文类型
	): Promise<Response> { // 返回 Promise<Response>
   // 动态设置 Access-Control-Allow-Origin
   const allowedOrigins = [
	'https://my-cloud-page.pages.dev', // 你的生产环境前端域名
	'http://localhost:3000'                 // 本地开发环境
	// 如果你有其他前端域名，也添加到这里
  ];
  const origin = request.headers.get('Origin');
  let corsOrigin = '';

  if (origin && allowedOrigins.includes(origin)) {
	corsOrigin = origin; // 如果请求来源在允许列表中，则使用该来源
  } else if (!origin && request.method !== 'OPTIONS') {
	// 对于没有 Origin 头的非预检请求 (例如直接用 curl 或 Postman 测试部署后的 Worker)
	// 并且你希望允许它们，可以设置一个默认值或保持为空。
	// 如果是 '*'，则表示允许所有，但通常不推荐用于生产环境的实际数据请求。
	// 对于本地测试，如果直接 curl，可能没有 Origin 头。
	// 但从浏览器 localhost:3000 访问时，一定会有 Origin 头。
  }

	  // CORS 头部设置
	  const corsHeaders = {
		'Access-Control-Allow-Origin': corsOrigin, // 生产环境请替换为你的前端域名
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	  };
  
	 // 处理 OPTIONS 预检请求 (CORS)
	 if (request.method === 'OPTIONS') {
		// 确保预检请求也返回正确的、动态的 corsOrigin
		// 并且 Access-Control-Allow-Headers 包含前端实际会发送的头部
		if (origin && allowedOrigins.includes(origin)) {
		  return new Response(null, { headers: corsHeaders });
		} else {
		  // 如果来源不在允许列表中，可以返回一个没有 CORS 头部的响应或特定错误
		  return new Response('CORS origin not allowed', { status: 403 });
		}
	  }
  
	  // 只允许 POST 请求
	  if (request.method !== 'POST') {
		const errorResponse: WorkerErrorResponse = { error: 'Expected POST request' };
		return new Response(JSON.stringify(errorResponse), {
		  status: 405,
		  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	  }
  
	  try {
		// 1. 从前端请求中获取用户消息
		let requestBody: FrontendRequestBody;
		try {
		  requestBody = await request.json<FrontendRequestBody>();
		} catch (e) {
		  const errorResponse: WorkerErrorResponse = { error: 'Invalid JSON in request body' };
		  return new Response(JSON.stringify(errorResponse), {
			status: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		  });
		}
		
		const userMessage = requestBody.message;
  
		if (!userMessage || typeof userMessage !== 'string' ) {
		  const errorResponse: WorkerErrorResponse = { error: 'Missing or invalid "message" in request body' };
		  return new Response(JSON.stringify(errorResponse), {
			status: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		  });
		}
  
		// 2. 从 Worker Secrets 中获取 Gemini API 密钥
		const apiKey = env.GEMINI_API_KEY;
		if (!apiKey) {
		  console.error('GEMINI_API_KEY not configured in Worker Secrets');
		  const errorResponse: WorkerErrorResponse = { error: 'AI service not configured' };
		  return new Response(JSON.stringify(errorResponse), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		  });
		}
  
		// 3. 准备向 Gemini API 发送的请求
		const modelName = 'gemini-1.5-flash-latest'; // 或你选择的其他模型
		const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
		const geminiRequestBody: GeminiRequestBody = {
		  contents: [{ parts: [{ text: userMessage }] }],
		  // 可选: 配置 generationConfig 和 safetySettings
		  // generationConfig: {
		  //   temperature: 0.7,
		  //   maxOutputTokens: 1000,
		  // },
		  // safetySettings: [
		  //   { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
		  // ],
		};
  
		// 4. 从 Worker 向 Gemini API 发送请求
		const geminiResponse = await fetch(GEMINI_API_ENDPOINT, {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
		  },
		  body: JSON.stringify(geminiRequestBody),
		});
  
		// 检查 Gemini API 的响应状态
		if (!geminiResponse.ok) {
		  let errorDetails: any = await geminiResponse.text(); // 保持为 any 以便灵活处理
		  try {
			errorDetails = JSON.parse(errorDetails as string); // 尝试解析为JSON
		  } catch (e) { /* 如果不是JSON，则保持为文本 */ }
  
		  console.error(`Gemini API Error: ${geminiResponse.status} ${geminiResponse.statusText}`, errorDetails);
		  const errorResponse: WorkerErrorResponse = {
			error: `Gemini API Error: ${geminiResponse.statusText}`,
			details: errorDetails,
		  };
		  return new Response(JSON.stringify(errorResponse), {
			status: geminiResponse.status,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		  });
		}
  
		// 5. 获取 Gemini API 的响应数据
		const geminiData = await geminiResponse.json<GeminiApiResponse>();
  
		// 6. 从 Gemini API 响应中提取回复文本
		let reply = "抱歉，我暂时无法获取回复。"; // 默认回复
  
		const candidate = geminiData.candidates?.[0]; // 使用可选链安全访问
  
		if (candidate?.content?.parts?.[0]?.text) {
		  reply = candidate.content.parts[0].text;
		} else if (candidate?.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
		  // 处理因安全或其他原因被阻止的情况
		  reply = `由于以下原因，我无法生成回复：${candidate.finishReason}.`;
		  if (geminiData.promptFeedback?.blockReason) {
			reply += ` (具体原因: ${geminiData.promptFeedback.blockReason})`;
		  }
		} else if (geminiData.promptFeedback?.blockReason) {
		  // 如果整个提示被阻止
		  reply = `您的请求由于 ${geminiData.promptFeedback.blockReason} 被阻止。`;
		} else {
		  // 如果响应结构不符合预期，记录日志
		  console.warn('Unexpected Gemini API response structure or no content:', JSON.stringify(geminiData, null, 2));
		}
  
		const successResponse: WorkerSuccessResponse = { reply };
		return new Response(JSON.stringify(successResponse), {
		  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
  
	  } catch (error: any) { // 明确捕获的 error 类型为 any 或 unknown
		console.error('Error in Worker:', error);
		const errorResponse: WorkerErrorResponse = { error: 'Internal Server Error', details: error.message || String(error) };
		return new Response(JSON.stringify(errorResponse), {
		  status: 500,
		  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	  }
	},
  };