export interface TextChunk {
  id: string;
  content: string;
  tokens: number; // 可以考虑重命名为charCount，或添加注释说明这实际是字符数
  selected: boolean;
}

/**
 * 问题类型定义
 *
 * ── 普通检索数据集推荐类型 ──
 * factoid    事实型   - 基于文本直接陈述的事实（时间、人物、数量等）
 * conceptual 概念型   - 解释或阐述某个概念、定义
 * procedural 程序型   - 涉及操作步骤、流程
 *
 * ── 高级检索数据集推荐类型 ──
 * reasoning  推理型   - 需要从文本信息推导出隐含结论（因果、条件推断）
 * inferential 归纳型  - 需要跨多个段落/文档归纳出规律或总结
 * comparative 比较型  - 对比不同信息、观点或实体的异同
 */
export type QuestionType = 'factoid' | 'conceptual' | 'procedural' | 'reasoning' | 'inferential' | 'comparative';

export interface GenerationParams {
  count: number; // 每个块生成的问答对数量
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  questionTypes: QuestionType[];
  maxTokens?: number; // 回答的最大token数
  concurrency?: number; // 并发数字段
  datasetType?: 'standard' | 'advanced'; // 数据集类型，影响提示词策略
}

export interface GeneratedQA {
  id: string;
  question: string;
  answer: string;
  difficulty: string;
  category: string;
  sourceChunkId: string;
  sourceFileName: string;
  // 新增失败状态字段
  status?: 'success' | 'failed';
  // 失败的原因
  errorReason?: string;
  // 大模型的原始响应
  rawResponse?: string;
}

export interface ProgressInfo {
  totalChunks: number;
  completedChunks: number;
  totalQAPairs: number;
  generatedQAPairs: number;
  currentChunk?: TextChunk;
  error?: string;
  isCompleted: boolean;
}

export interface GenerationResult {
  qaPairs: GeneratedQA[];
  progress: ProgressInfo;
}

export interface PromptTemplate {
  name: string;
  template: string;
  description: string;
}

export interface LLMRequestPayload {
  model: string;
  messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[];
  temperature: number;
  max_tokens: number;
} 