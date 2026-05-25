import { v4 as uuidv4 } from 'uuid';
import { 
  TextChunk, 
  GenerationParams, 
  GeneratedQA, 
  ProgressInfo,
  LLMRequestPayload
} from '../types/question-generator';
import { datasetService } from './dataset.service';
import { ConfigManager, ModelConfig } from '@utils/configManager';
import { LLMClient } from '../pages/Settings/LLMTemplates/llm-request';

// 替换为新的导入路径
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import OpenAI from 'openai';

// 定义分割策略类型
export type SplitterType = 'recursive' | 'code' | 'markdown' | 'html' | 'latex';

// 失败记录的详细信息类型
export interface FailedRequestRecord {
  id: string;
  chunkId: string;
  sourceFileName: string;
  timestamp: string;
  promptText: string; // 请求提示词
  errorMessage: string; // 错误信息
  rawResponse?: string; // 大模型原始响应（如果有）
  chunkContent?: string; // 失败的文本块内容
}

export class QuestionGeneratorService {
  private chunks: TextChunk[] = [];
  private generatedQAs: GeneratedQA[] = [];
  private progress: ProgressInfo = {
    totalChunks: 0,
    completedChunks: 0,
    totalQAPairs: 0,
    generatedQAPairs: 0,
    isCompleted: false
  };
  private processingPromises: Promise<any>[] = [];
  private maxConcurrentRequests = 3;
  private datasetId: string | null = null;
  private fileSourceMap: Map<string, string> = new Map(); // 用于存储分块ID和源文件名的映射
  private defaultChunkSize = 1000;
  private splitterType: SplitterType = 'recursive';
  private isStopped: boolean = false; // 添加停止标志
  
  // 失败记录列表
  private failedRequests: FailedRequestRecord[] = [];
  private activeLLMClients: LLMClient[] = []; // 添加活跃的LLMClient列表

  // ───────────────────────────────────────────────────────────
  // 难度等级定义（RAG 评测语境）
  //
  // easy（简单）- 普通检索
  //   答案可以在单一文本片段中直接找到，无需推理。
  //   典型问题：特定时间、人名、数量、单步骤操作。
  //
  // medium（中等）- 需一定理解
  //   答案需要整合同一文档中 2-3 个相关事实，或对概念进行简单解释。
  //   典型问题：概念解释、两步骤推导、同段落内的比较。
  //
  // hard（困难）- 高级检索（推理/归纳）
  //   答案需要跨多个段落/文档进行信息整合，或通过推理、归纳得出，
  //   文本中没有直接陈述，需要综合分析。
  //   典型问题：因果推断、跨文档归纳、复杂比较、隐含信息推断。
  // ───────────────────────────────────────────────────────────

  // 普通检索数据集提示词模板（standard）
  // 以 easy/medium 难度为主，聚焦直接事实检索
  private defaultPromptTemplate = `你是一个专业的问答对生成专家，擅长根据文本生成多样性高、质量优的问答对。
请根据以下文本生成 {{count}} 个问答对：

文本内容：
"{{text}}"

### 难度等级定义（RAG检索难度）：
- **简单（easy）**：答案可以在单一文本片段中直接找到，无需推理。例如：特定时间、人名、数量等直接陈述的事实。
- **中等（medium）**：答案需要整合同一段落中 2-3 个相关事实，或对概念进行简单解释。
- **困难（hard）**：答案需要跨多个段落进行信息整合，或通过推理/归纳得出，文本中没有直接陈述。

### 生成要求：
1. **问题：**
   - 问题要精准、清晰，直接基于文本内容，避免使用"本文"、"文中"、"文章中"等字眼。
   - 模拟用户提问的方式，问题应自然流畅。
   - 难度分布：简单占 50%，中等占 40%，困难占 10%。
2. **答案：**
   - 简明扼要，紧扣问题核心，不要超出文本信息。
3. **类别：**
   - 包括以下类别（优先选用前两种）：
     - 事实型（factoid）：基于文本直接陈述的事实（时间、人物、数量等）
     - 概念型（conceptual）：解释或阐述某个概念、定义
     - 程序型（procedural）：涉及操作步骤或流程
     - 比较型（comparative）：比较不同信息或观点（较少使用）

### 输出格式要求：
- 以 JSON 数组格式返回，格式如下：
\`\`\`json
[
  {
    "question": "问题内容",
    "answer": "答案内容",
    "difficulty": "easy/medium/hard",
    "category": "factoid/conceptual/procedural/comparative"
  }
]
\`\`\`
请注意：
1. 确保问答对具有高质量、多样性，并严格按照指定格式输出。
2. difficulty 字段必须使用英文：easy、medium 或 hard。
3. category 字段必须从以下英文值中选择：factoid、conceptual、procedural、comparative。
`;

  // 高级检索数据集提示词模板（advanced）
  // 以 medium/hard 难度为主，聚焦推理、归纳、多跳检索
  private advancedPromptTemplate = `你是一个专业的问答对生成专家，专注于生成需要深度理解和推理的高质量问答对。
请根据以下文本生成 {{count}} 个高级检索问答对：

文本内容：
"{{text}}"

### 难度等级定义（RAG检索难度）：
- **简单（easy）**：答案可以在单一文本片段中直接找到，无需推理。（本数据集较少使用）
- **中等（medium）**：答案需要整合同一段落中 2-3 个相关事实，需要理解关系或进行简单推断。
- **困难（hard）**：答案无法从单一片段直接获取，需要跨段落信息整合、因果推理、归纳总结或隐含推断。

### 生成要求：
1. **问题：**
   - 问题要体现较高的认知层次，需要用户进行推理、对比或综合分析。
   - 避免可以直接在文本中找到答案的简单查询型问题。
   - 难度分布：简单占 10%，中等占 40%，困难占 50%。
2. **答案：**
   - 答案应清晰展示推理过程或综合依据，不仅仅是摘录原文。
3. **类别（重点使用以下高级类型）：**
   - 推理型（reasoning）：需要从文本信息推导出隐含结论，如因果推断、条件推断
   - 归纳型（inferential）：需要跨多个段落归纳出规律、模式或总体性结论
   - 比较型（comparative）：对比不同信息、观点、实体的异同并得出判断
   - 概念型（conceptual）：深度理解和解释复杂概念（较少使用）

### 输出格式要求：
- 以 JSON 数组格式返回，格式如下：
\`\`\`json
[
  {
    "question": "问题内容",
    "answer": "答案内容（体现推理过程）",
    "difficulty": "easy/medium/hard",
    "category": "reasoning/inferential/comparative/conceptual"
  }
]
\`\`\`
请注意：
1. 确保问答对具有高质量，体现深度理解能力，并严格按照指定格式输出。
2. difficulty 字段必须使用英文：easy、medium 或 hard。
3. category 字段必须从以下英文值中选择：reasoning、inferential、comparative、conceptual。
`;

  constructor() {
    this.resetState();
  }

  public resetState(): void {
    this.chunks = [];
    this.generatedQAs = [];
    this.progress = {
      totalChunks: 0,
      completedChunks: 0,
      totalQAPairs: 0,
      generatedQAPairs: 0,
      isCompleted: false
    };
    this.processingPromises = [];
    this.fileSourceMap = new Map();
    // 重置失败记录
    this.failedRequests = [];
    this.activeLLMClients = [];
    this.isStopped = false; // 重置停止标志
  }
  
  // 获取失败记录列表
  public getFailedRequests(): FailedRequestRecord[] {
    return this.failedRequests;
  }

  // 处理和分析上传的文件
  public async processFiles(files: File[], chunkSize?: number): Promise<TextChunk[]> {
    this.resetState();
    const textContents: {content: string, fileName: string}[] = [];
    
    // 使用传入的chunkSize或默认值
    const targetChunkSize = chunkSize || this.defaultChunkSize;

    // 读取所有文件内容
    for (const file of files) {
      const content = await this.readFileContent(file);
      textContents.push({
        content,
        fileName: file.name
      });
    }

    // 处理每个文件并保留文件名信息
    for (const {content, fileName} of textContents) {
      // 传递目标块大小
      const fileChunks = this.splitTextIntoChunks(content, fileName, targetChunkSize);
      this.chunks.push(...fileChunks);
    }
    
    this.progress.totalChunks = this.chunks.filter(chunk => chunk.selected).length;
    
    return this.chunks;
  }

  // 读取文件内容
  private async readFileContent(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        if (e.target?.result) {
          resolve(e.target.result as string);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      
      reader.onerror = () => {
        reject(new Error(`Error reading file: ${file.name}`));
      };
      
      // 根据文件类型处理
      if (file.type === 'application/pdf') {
        // 实际项目中应该使用PDF解析库
        // 这里简化处理，假设PDF被读作文本
        reader.readAsText(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // 实际项目中应该使用DOCX解析库
        // 这里简化处理，假设DOCX被读作文本
        reader.readAsText(file);
      } else {
        // 对于文本文件直接读取
        reader.readAsText(file);
      }
    });
  }

  // 文本分块
  private splitTextIntoChunks(text: string, fileName: string, targetChunkSize: number): TextChunk[] {
    // 基本的分块策略，按段落分割并合并到合适大小
    const paragraphs = text.split(/\n\s*\n/);
    console.log(`分块: ${fileName}, 共 ${paragraphs.length} 个段落, 目标大小: ${targetChunkSize} 字符`);
    
    const chunks: TextChunk[] = [];
    
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;
      
      // 估算段落的token数
      const paragraphTokens = this.calculateCharCount(paragraph);
      
      if (currentTokens + paragraphTokens > targetChunkSize && currentChunk !== '') {
        // 创建新块
        const chunkId = uuidv4();
        chunks.push({
          id: chunkId,
          content: currentChunk,
          tokens: currentTokens,
          selected: true
        });
        this.fileSourceMap.set(chunkId, fileName);
        
        currentChunk = paragraph;
        currentTokens = paragraphTokens;
      } else {
        // 添加到当前块
        if (currentChunk !== '') {
          currentChunk += '\n\n';
        }
        currentChunk += paragraph;
        currentTokens += paragraphTokens;
      }
    }
    
    // 添加最后一个块
    if (currentChunk !== '') {
      const chunkId = uuidv4();
      chunks.push({
        id: chunkId,
        content: currentChunk,
        tokens: currentTokens,
        selected: true
      });
      this.fileSourceMap.set(chunkId, fileName);
    }
    
    console.log(`${fileName} 分块完成，共 ${chunks.length} 个块`);
    return chunks;
  }

  // 更新块的选择状态
  public updateChunkSelection(chunkId: string, selected: boolean): void {
    const chunk = this.chunks.find(c => c.id === chunkId);
    if (chunk) {
      chunk.selected = selected;
      this.progress.totalChunks = this.chunks.filter(c => c.selected).length;
    }
  }

  // 生成问答对
  public async generateQAPairs(
    params: GenerationParams, 
    datasetId: string,
    modelId: string, 
    onProgress: (progress: ProgressInfo, newQAs?: GeneratedQA[]) => void,
    customPromptTemplate?: string
  ): Promise<GeneratedQA[]> {
    this.datasetId = datasetId;
    this.isStopped = false; // 重置停止标志
    // 设置并发数
    if (params.concurrency && params.concurrency > 0) {
      this.maxConcurrentRequests = params.concurrency;
      console.log(`设置并发请求数为: ${this.maxConcurrentRequests}`);
    }
    // 计算总共需要生成的问答对数量
    const selectedChunks = this.chunks.filter(chunk => chunk.selected);
    this.progress.totalChunks = selectedChunks.length;
    this.progress.totalQAPairs = selectedChunks.length * params.count;
    this.progress.completedChunks = 0;
    this.progress.generatedQAPairs = 0;
    this.progress.isCompleted = false;
    onProgress({...this.progress});
    // 设置并发处理队列
    let activePromises: Promise<any>[] = [];
    this.generatedQAs = [];
    try {
      for (const chunk of selectedChunks) {
        // 检查是否已停止
        if (this.isStopped) {
          console.log('生成已停止，取消未发出的请求');
          break;
        }

        this.progress.currentChunk = chunk;
        onProgress({...this.progress});
        // 创建当前块的处理Promise
        const processPromise = this.processChunk(chunk, params, modelId, customPromptTemplate)
          .then(qaPairs => {
            // 更新进度
            this.progress.completedChunks++;
            this.progress.generatedQAPairs += qaPairs.length;
            this.progress.currentChunk = undefined;
            // 将生成的问答对添加到结果中
            this.generatedQAs.push(...qaPairs);
            // 回调，传递进度和新生成的问答对
            onProgress({...this.progress}, qaPairs);
            // 如果是增量保存，这里可以调用保存API
            if (this.datasetId) {
              this.saveQAPairsBatch(qaPairs, this.datasetId);
            }
            return qaPairs;
          })
          .catch(error => {
            console.error('处理分块时出错:', error);
            this.progress.error = `处理分块时出错: ${error.message}`;
            this.progress.completedChunks++;
            onProgress({...this.progress});  
          });
        activePromises.push(processPromise);
        // 如果达到最大并发数，等待其中一个完成
        if (activePromises.length >= this.maxConcurrentRequests) {
          let completedPromiseIndex: number | null = null;
          await Promise.race(activePromises)
            .then(() => {
              // 一旦有Promise完成，我们只需要从列表中移除它
              completedPromiseIndex = 0;
            });
          // 移除一个已完成的Promise
          if (completedPromiseIndex !== null) {
            activePromises.splice(completedPromiseIndex, 1);
          }
        }
      }
      // 等待所有剩余的处理完成
      await Promise.all(activePromises);
      // 标记为完成
      this.progress.isCompleted = true;
      onProgress({...this.progress});
      return this.generatedQAs;
    } catch (error) {
      throw error;
    }
  }

  // 处理单个文本块
  private async processChunk(
    chunk: TextChunk, 
    params: GenerationParams, 
    modelId: string,
    customPromptTemplate?: string
  ): Promise<GeneratedQA[]> {
    // 构建提示词，传入自定义模板
    const prompt = this.buildPrompt(chunk.content, params, customPromptTemplate);

    try {
      // 创建LLMClient实例
      const llmClient = await LLMClient.createFromConfigId(modelId);
      // 添加到活跃客户端列表
      this.activeLLMClients.push(llmClient);

      // 调用LLM API
      const response = await this.callLLMAPI(prompt, params, llmClient);
      
      // 从活跃客户端列表中移除
      this.activeLLMClients = this.activeLLMClients.filter(client => client !== llmClient);
      
      // 解析响应生成问答对
      const qaPairs = this.parseResponse(response, chunk.id);
      
      return qaPairs;
    } catch (error) {
      console.error(`处理分块 ${chunk.id} 失败:`, error);
      console.error('处理分块失败:', error);

      // 记录失败详情
      const sourceFileName = this.fileSourceMap.get(chunk.id) || '未知文件';
      
      // 创建失败记录
      const failedRecord: FailedRequestRecord = {
        id: uuidv4(),
        chunkId: chunk.id,
        sourceFileName,
        timestamp: new Date().toISOString(),
        promptText: prompt,
        errorMessage: error.message,
        chunkContent: chunk.content,
        rawResponse: error.rawResponse || '',
      };

      console.log('失败记录:', failedRecord);
      
      // 添加到失败记录列表
      this.failedRequests.push(failedRecord);
      
      throw error;
    }
  }

  // 构建提示词
  // 根据 datasetType 选择对应模板（standard / advanced），支持自定义模板覆盖
  private buildPrompt(text: string, params: GenerationParams, customTemplate?: string): string {
    // 优先使用自定义模板，其次根据数据集类型选择内置模板
    let prompt: string;
    if (customTemplate) {
      prompt = customTemplate;
    } else if (params.datasetType === 'advanced') {
      prompt = this.advancedPromptTemplate;
    } else {
      prompt = this.defaultPromptTemplate;
    }

    // 替换基础占位符
    prompt = prompt.replace(/\{\{text\}\}/g, text);
    prompt = prompt.replace(/\{\{count\}\}/g, params.count.toString());

    // 如果用户明确选择了问题类型，追加约束说明
    if (!customTemplate && params.questionTypes && params.questionTypes.length > 0) {
      const selectedTypes = params.questionTypes.join('、');
      prompt += `\n\n> **注意：** 本次仅生成以下类型的问题：${selectedTypes}，category 字段值必须从这些类型中选择。`;
    }

    return prompt;
  }

  // 调用LLM API
  private async callLLMAPI(prompt: string, params: GenerationParams, llmClient: LLMClient): Promise<string> {
    try {
      // 调用LLM API
      const response = await llmClient.chatCompletion({
        userMessage: prompt,
        systemMessage: '你是一个专业的问答对生成专家，擅长根据文本生成多样性高、质量优的问答对。',
        additionalParams: {
          temperature: 0.2,
          max_tokens: params.maxTokens || 2048
        }
      });

      return response;
    } catch (error: any) {
      // 增强错误处理，保存更多错误信息
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('请求已取消');
      }
      
      // 捕获更多错误信息
      const enhancedError: any = new Error(`API调用失败: ${error.message}`);
      enhancedError.status = error.status || error.statusCode;
      enhancedError.statusText = error.statusText;
      enhancedError.headers = error.headers;
      
      // 如果有原始响应体，添加到错误对象
      if (error.response) {
        try {
          enhancedError.responseBody = typeof error.response === 'string' 
            ? JSON.parse(error.response) 
            : error.response;
        } catch {
          enhancedError.responseBody = error.response;
        }
      }
      
      throw enhancedError;
    }
  }

  // ───────────────────────────────────────────────────────────
  // 难度值规范化：统一转换为英文 easy/medium/hard
  // 处理 LLM 可能返回的中英文混合情况
  // ───────────────────────────────────────────────────────────
  private normalizeDifficulty(raw: string): 'easy' | 'medium' | 'hard' {
    const val = (raw || '').trim().toLowerCase();
    // 中文映射
    if (val === '简单' || val === '容易') return 'easy';
    if (val === '中等' || val === '普通') return 'medium';
    if (val === '困难' || val === '难') return 'hard';
    // 英文映射
    if (val === 'easy') return 'easy';
    if (val === 'medium') return 'medium';
    if (val === 'hard') return 'hard';
    // 默认返回 medium
    return 'medium';
  }

  // ───────────────────────────────────────────────────────────
  // 类别值规范化：统一转换为英文类别键
  // 支持所有普通检索 + 高级检索类别
  // ───────────────────────────────────────────────────────────
  private normalizeCategory(raw: string): string {
    const val = (raw || '').trim();
    // 中文 → 英文
    const zhMap: Record<string, string> = {
      '事实型': 'factoid',
      '概念型': 'conceptual',
      '程序型': 'procedural',
      '比较型': 'comparative',
      '推理型': 'reasoning',
      '归纳型': 'inferential',
    };
    if (zhMap[val]) return zhMap[val];
    // 英文直通（合法值）
    const validCategories = ['factoid', 'conceptual', 'procedural', 'comparative', 'reasoning', 'inferential'];
    if (validCategories.includes(val.toLowerCase())) return val.toLowerCase();
    // 默认
    return 'factoid';
  }

  // 解析LLM响应
  private parseResponse(response: string, chunkId: string): GeneratedQA[] {
    try {
      // 尝试提取JSON部分
      const jsonMatch = response.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        throw new Error('无法从响应中提取JSON格式的问答对');
      }

      const qaPairsData = JSON.parse(jsonMatch[0]);

      // 获取文件名
      const sourceFileName = this.fileSourceMap.get(chunkId) || '未知文件';

      // 验证并转换为标准格式（规范化 difficulty 和 category 为英文）
      const qaPairs: GeneratedQA[] = qaPairsData.map((item: any) => ({
        id: uuidv4(),
        question: item.question,
        answer: item.answer,
        difficulty: this.normalizeDifficulty(item.difficulty),
        category: this.normalizeCategory(item.category),
        sourceChunkId: chunkId,
        sourceFileName: sourceFileName
      }));

      return qaPairs;
    } catch (error) {
      console.error('解析LLM响应失败:', error, 'Response:', response);
      const errorInfo = {
        rawResponse: response,
        message: '解析响应失败: ' + (error as Error).message
      };

      throw errorInfo;
    }
  }

  // 保存问答对到后端
  private async saveQAPairsBatch(qaPairs: GeneratedQA[], datasetId: string): Promise<void> {
    try {
      // 转换为后端API需要的格式
      const questions = qaPairs.map(qa => ({
        question_text: qa.question,
        standard_answer: qa.answer,
        category: qa.category,
        difficulty: qa.difficulty,
        type: qa.category,
        tags: [],
        question_metadata: {
          source_chunk_id: qa.sourceChunkId,
          source_file_name: qa.sourceFileName,
          generated_by: "auto_qa_generator"
        }
      }));
      
      // 调用后端API保存
      await datasetService.batchCreateQuestions(datasetId, questions);
    } catch (error) {
      console.error('保存问答对失败:', error);
      // 如果失败，可以考虑添加重试逻辑
    }
  }

  // 中止生成过程
  public stopGeneration(): void {
    this.isStopped = true; // 设置停止标志
    this.progress.error = '生成已手动停止';
    this.progress.isCompleted = true;
    this.progress.completedChunks = this.progress.totalChunks;
    this.progress.generatedQAPairs = this.generatedQAs.length;
  }

  // 修改方法名和实现
  private calculateCharCount(text: string): number {
    // 直接返回字符数而不是token数
    return text.length;
  }

  // 将原来的estimateTokenCount方法使用新方法替代
  private estimateTokenCount(text: string): number {
    return this.calculateCharCount(text);
  }

  // 设置分割策略
  public setSplitterType(type: SplitterType): void {
    this.splitterType = type;
    console.log(`分割策略已设置为: ${type}`);
  }
  
  // 获取当前分割策略
  public getSplitterType(): SplitterType {
    return this.splitterType;
  }
  
  // 使用LangChain文本分割器处理文本
  private async splitTextWithLangChain(text: string, fileName: string, targetChunkSize: number): Promise<TextChunk[]> {
    console.log(`使用LangChain分割文本，策略: ${this.splitterType}, 目标大小: ${targetChunkSize} 字符`);
    
    let splitter;
    let docs: Document[] = [];
    
    try {
      // 根据文件名判断文件类型，用于代码分割器
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
      
      // 定义支持的语言类型，与 RecursiveCharacterTextSplitter.fromLanguage 匹配
      type SupportedLanguage = 'markdown' | 'html' | 'latex' | 'go' | 'ruby' | 'js' | 'python' | 'java' | 'cpp' | 'php' | 'proto' | 'rst' | 'rust' | 'scala' | 'swift' | 'sol';
      
      let codeLanguage: SupportedLanguage | undefined;
      
      // 根据文件扩展名映射到代码语言
      switch (fileExtension) {
        case 'js':
        case 'jsx':
          codeLanguage = 'js';
          break;
        case 'ts':
        case 'tsx':
          codeLanguage = 'js'; // 使用js分割器处理TypeScript
          break;
        case 'py':
          codeLanguage = 'python';
          break;
        case 'java':
          codeLanguage = 'java';
          break;
        case 'html':
          codeLanguage = 'html';
          break;
        case 'md':
          codeLanguage = 'markdown';
          break;
        case 'tex':
          codeLanguage = 'latex';
          break;
        // 可以根据需要添加更多映射
      }
      
      // 根据设置的分割策略创建分割器
      switch (this.splitterType) {
        case 'code':
          if (codeLanguage) {
            // 如果文件扩展名映射到了支持的代码语言，使用代码分割器
            splitter = RecursiveCharacterTextSplitter.fromLanguage(codeLanguage, {
              chunkSize: targetChunkSize,
              chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
            });
          } else {
            // 否则使用通用递归分割器
            splitter = new RecursiveCharacterTextSplitter({
              chunkSize: targetChunkSize,
              chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
            });
          }
          break;
        case 'markdown':
          splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
            chunkSize: targetChunkSize,
            chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
          });
          break;
        case 'html':
          splitter = RecursiveCharacterTextSplitter.fromLanguage('html', {
            chunkSize: targetChunkSize,
            chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
          });
          break;
        case 'latex':
          splitter = RecursiveCharacterTextSplitter.fromLanguage('latex', {
            chunkSize: targetChunkSize,
            chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
          });
          break;
        case 'recursive':
        default:
          // 默认使用递归字符分割器
          splitter = new RecursiveCharacterTextSplitter({
            chunkSize: targetChunkSize,
            chunkOverlap: Math.min(Math.floor(targetChunkSize * 0.1), 100)
          });
          break;
      }
      
      // 使用LangChain分割文本
      docs = await splitter.createDocuments([text]);
      console.log(`LangChain分割完成，共 ${docs.length} 个块`);
      
    } catch (error) {
      console.error('LangChain分割文本出错:', error);
      // 如果LangChain分割失败，回退到原来的分割方法
      console.log('回退到基础分割方法');
      return this.legacySplitTextIntoChunks(text, fileName, targetChunkSize);
    }
    
    // 将LangChain文档转换为我们的TextChunk格式
    const chunks: TextChunk[] = [];
    for (const doc of docs) {
      const content = doc.pageContent;
      if (!content.trim()) continue;
      
      const chunkId = uuidv4();
      // 使用字符数
      const charCount = this.calculateCharCount(content);
      
      chunks.push({
        id: chunkId,
        content: content,
        tokens: charCount, // 这里仍使用tokens字段但实际是字符数
        selected: true
      });
      
      // 保存源文件信息
      this.fileSourceMap.set(chunkId, fileName);
    }
    
    return chunks;
  }
  
  // 原来的分割方法保留为备用
  private legacySplitTextIntoChunks(text: string, fileName: string, targetChunkSize: number): TextChunk[] {
    // 原来的分块实现
    const paragraphs = text.split(/\n\s*\n/);
    console.log(`原始分块: ${fileName}, 共 ${paragraphs.length} 个段落, 目标大小: ${targetChunkSize} 字符`);
    
    const chunks: TextChunk[] = [];
    
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;
      
      // 估算段落的token数
      const paragraphTokens = this.calculateCharCount(paragraph);
      
      if (currentTokens + paragraphTokens > targetChunkSize && currentChunk !== '') {
        // 创建新块
        const chunkId = uuidv4();
        chunks.push({
          id: chunkId,
          content: currentChunk,
          tokens: currentTokens,
          selected: true
        });
        this.fileSourceMap.set(chunkId, fileName);
        
        currentChunk = paragraph;
        currentTokens = paragraphTokens;
      } else {
        // 添加到当前块
        if (currentChunk !== '') {
          currentChunk += '\n\n';
        }
        currentChunk += paragraph;
        currentTokens += paragraphTokens;
      }
    }
    
    // 添加最后一个块
    if (currentChunk !== '') {
      const chunkId = uuidv4();
      chunks.push({
        id: chunkId,
        content: currentChunk,
        tokens: currentTokens,
        selected: true
      });
      this.fileSourceMap.set(chunkId, fileName);
    }
    
    console.log(`${fileName} 分块完成，共 ${chunks.length} 个块`);
    return chunks;
  }
  
  // 修改处理文本内容的方法，使用新的分割器
  public async processContentFiles(contentFiles: {name: string, content: string}[], chunkSize?: number, splitterType?: SplitterType): Promise<TextChunk[]> {
    this.resetState();
    
    // 设置分割策略（如果提供）
    if (splitterType) {
      this.setSplitterType(splitterType);
    }
    
    // 使用传入的chunkSize或默认值
    const targetChunkSize = chunkSize || this.defaultChunkSize;
    console.log(`处理文本内容，使用块大小: ${targetChunkSize} 字符, 分割策略: ${this.splitterType}`);
    
    // 处理每个文件并保留文件名信息
    for (const {content, name} of contentFiles) {
      // 传递目标块大小，使用LangChain分割器
      console.log(`处理文件: ${name}, 内容大小: ${content.length} 字符`);
      const fileChunks = await this.splitTextWithLangChain(content, name, targetChunkSize);
      console.log(`文件 ${name} 生成了 ${fileChunks.length} 个块`);
      this.chunks.push(...fileChunks);
    }
    
    this.progress.totalChunks = this.chunks.filter(chunk => chunk.selected).length;
    
    return this.chunks;
  }

  // 添加获取块源文件的方法
  public getChunkSourceFile(chunkId: string): string | undefined {
    return this.fileSourceMap.get(chunkId);
  }

  // 添加公共方法用于预览提示词
  public previewPrompt(text: string, params: GenerationParams, customTemplate?: string): string {
    return this.buildPrompt(text, params, customTemplate);
  }

  // 获取普通检索数据集默认提示词模板
  public getDefaultPromptTemplate(): string {
    return this.defaultPromptTemplate;
  }

  // 获取高级检索数据集提示词模板
  public getAdvancedPromptTemplate(): string {
    return this.advancedPromptTemplate;
  }

  // 根据数据集类型获取对应提示词模板
  public getPromptTemplateByType(datasetType: 'standard' | 'advanced'): string {
    return datasetType === 'advanced' ? this.advancedPromptTemplate : this.defaultPromptTemplate;
  }
}

// 导出单例实例
export const questionGeneratorService = new QuestionGeneratorService(); 