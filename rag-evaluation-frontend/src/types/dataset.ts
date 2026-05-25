/**
 * 数据集类型定义
 *
 * standard - 普通检索数据集
 *   以直接事实检索为主，问题答案可从单一文本段落中直接找到。
 *   难度分布以 easy/medium 为主，问题类型以事实型(factoid)、概念型(conceptual)为主。
 *   用途：测试 RAG 系统基础检索准确性。
 *
 * advanced - 高级检索数据集
 *   包含需要推理、归纳或跨文档整合的问题，答案无法直接从单一片段获取。
 *   难度分布以 medium/hard 为主，问题类型包含推理型(reasoning)、归纳型(inferential)、比较型(comparative)。
 *   用途：测试 RAG 系统的深度理解、多跳检索和推理能力。
 */
export type DatasetType = 'standard' | 'advanced';

export interface Dataset {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_public: boolean;
  tags: string[];
  dataset_metadata: Record<string, any>;
  /** 数据集类型: standard=普通检索, advanced=高级检索(含推理/归纳) */
  dataset_type: DatasetType;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetDetail extends Dataset {
  projects: Array<{
    id: string;
    name: string;
  }>;
}

export interface Question {
  id: string;
  dataset_id: string;
  question_text: string;
  standard_answer: string;
  category?: string;
  difficulty?: string;
  type?: string;
  tags?: Record<string, any>;
  question_metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateDatasetRequest {
  name: string;
  description?: string;
  is_public: boolean;
  tags?: string[];
  dataset_metadata?: Record<string, any>;
  dataset_type?: DatasetType;
}

export interface UpdateDatasetRequest {
  name?: string;
  description?: string;
  is_public?: boolean;
  tags?: string[];
  dataset_metadata?: Record<string, any>;
  dataset_type?: DatasetType;
}

export interface DatasetListParams {
  page?: number;
  size?: number;
  search?: string;
  tag?: string;
  is_public?: boolean;
}

export interface ImportDataRequest {
  dataset_id: string;
  file?: File;
  questions?: Array<{
    question_text: string;
    standard_answer: string;
    category?: string;
    difficulty?: string;
    tags?: Record<string, any>;
  }>;
}

export interface ProjectDatasetLink {
  project_id: string;
  dataset_id: string;
}

export interface BatchLinkDatasetsRequest {
  project_id: string;
  dataset_ids: string[];
}

export interface RagAnswer {
  id: string;
  question_id: string;
  answer_text: string;
  source_type: string;
  version: string;
  api_config_id?: string;
  response_time?: number;
  token_count?: number;
  dataset_metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface CreateRagAnswerRequest {
  question_id: string;
  answer_text: string;
  source_type: string;
  version?: string;
  api_config_id?: string;
  response_time?: number;
  token_count?: number;
  dataset_metadata?: any;
}

export interface ImportQuestionWithRagRequest {
  dataset_id: string;
  questions: {
    question_text: string;
    standard_answer: string;
    category?: string;
    difficulty?: string;
    type?: string;
    tags?: string[];
    rag_answer?: CreateRagAnswerRequest;
  }[];
} 