/**
 * 精度评测请求服务
 * 
 * 该模块提供了精度评测的核心功能，包括LLM评测请求和结果解析。
 * 它封装了与LLM交互的逻辑，提供统一的评测接口。
 * 
 */

import { LLMClient } from '@pages/Settings/LLMTemplates/llm-request';
import * as yaml from 'js-yaml';

/**
 * 精度评测服务类
 * 处理LLM评测请求和结果解析
 */
export class AccuracyRequestService {
  /**
   * 构建评测提示词
   * 
   * 将问题、参考答案和RAG答案插入到提示词模板中
   * 
   * @param {string} question - 问题文本
   * @param {string} referenceAnswer - 参考答案
   * @param {string} ragAnswer - RAG系统的回答
   * @param {string} promptTemplate - 提示词模板
   * @returns {string} 构建好的提示词
   */
  buildPrompt(question: string, referenceAnswer: string, ragAnswer: string, promptTemplate: string): string {
    // 替换提示词模板中的占位符
    let prompt = promptTemplate
      .replace('{{question}}', question)
      .replace('{{reference_answer}}', referenceAnswer)
      .replace('{{rag_answer}}', ragAnswer);
    
    return prompt;
  }

  /**
   * 执行LLM评测
   * 
   * 使用LLM客户端发送评测请求并获取响应
   * 
   * @param {string} prompt - 评测提示词
   * @param {string} modelConfigId - 模型配置ID
   * @returns {Promise<string>} LLM的响应文本
   */
  async evaluateWithLLM(prompt: string, modelConfigId: string): Promise<string> {
    const llmClient = await LLMClient.createFromConfigId(modelConfigId);
    const response = await llmClient.chatCompletion({
      userMessage: prompt,
      systemMessage: '你是一个专业的RAG回答评估专家，你的任务是评估生成式AI的回答质量。请根据提供的标准答案评价RAG系统的回答质量，分析其准确性、相关性和完整性。',
      additionalParams: {
        temperature: 0.2,
        // 预留足够空间，避免思考过程过长导致YAML被截断
        max_tokens: 4096
      }
    });
    return response;
  }

  /**
   * 从大模型返回的文本中提取YAML评估结果
   * 
   * @param {string} modelResponse - 大模型返回的文本内容，包含思考过程和评估结果
   * @returns {Object} 解析后的评估结果对象
   */
  extractEvaluationResult(modelResponse: string): {
    overall_score: number;
    dimension_scores: Record<string, number>;
    evaluation_reason: string;
    item_metadata: string
  } {
    try {
      // 去掉推理模型的 <think>...</think> 内容（包括被截断未闭合的情况）
      const cleaned = modelResponse
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/i, '')
        .trim();

      // 优先取 ```yaml / ```yml 代码块，取最后一个，避免思考过程中出现的代码块干扰
      const fencedBlocks = [...cleaned.matchAll(/```(?:ya?ml)?[ \t]*\n?([\s\S]*?)```/gi)]
        .map(m => m[1].trim())
        .filter(block => /overall_score\s*:/.test(block));
      let yamlContent = fencedBlocks.length > 0 ? fencedBlocks[fencedBlocks.length - 1] : '';

      // 没有完整代码块时，取最后一个 #### 之后的内容（兼容缺少结尾```或未加代码块的情况）
      if (!yamlContent) {
        const parts = cleaned.split('####');
        yamlContent = parts[parts.length - 1]
          .replace(/```(?:ya?ml)?/gi, '')
          .trim();
        // 从 overall_score 开始截取，去掉前面残留的思考文字
        const scoreIndex = yamlContent.search(/overall_score\s*:/);
        if (scoreIndex >= 0) {
          yamlContent = yamlContent.slice(scoreIndex);
        }
      }

      if (!/overall_score\s*:/.test(yamlContent)) {
        console.error('大模型返回内容格式不正确: 未找到 overall_score');
        return { overall_score: 0, dimension_scores: {}, evaluation_reason: '解析错误: 未找到 overall_score', item_metadata: modelResponse };
      }

      // 使用js-yaml库解析YAML内容，失败时用正则兜底提取
      let parsedYaml: any;
      try {
        parsedYaml = yaml.load(yamlContent);
      } catch (yamlError) {
        console.warn('YAML解析失败，使用正则兜底提取:', yamlError);
        parsedYaml = this.extractByRegex(yamlContent);
      }
      if (!parsedYaml || typeof parsedYaml !== 'object' || parsedYaml.overall_score === undefined) {
        parsedYaml = this.extractByRegex(yamlContent);
      }

      const result = {
        overall_score: 0,
        dimension_scores: {},
        evaluation_reason: '',
        item_metadata: modelResponse
      };
      
      // 提取总分
      if (parsedYaml.overall_score !== undefined) {
        const score = this.parseScore(parsedYaml.overall_score);
        if (score === null) {
          return { overall_score: 0, dimension_scores: {}, evaluation_reason: '解析错误: overall_score 不是数字', item_metadata: modelResponse };
        }
        result.overall_score = score;
      }
      
      // 提取维度评分 - 处理可能的数组格式
      if (parsedYaml.dimension_scores) {
        // 如果维度评分是数组形式
        if (Array.isArray(parsedYaml.dimension_scores)) {
          for (const item of parsedYaml.dimension_scores) {
            if (typeof item === 'object') {
              // 遍历对象中的每个属性
              for (const [dimension, score] of Object.entries(item)) {
                const parsed = this.parseScore(score);
                if (parsed !== null) result.dimension_scores[dimension] = parsed;
              }
            }
          }
        } 
        // 如果维度评分是对象形式
        else if (typeof parsedYaml.dimension_scores === 'object') {
          for (const [dimension, score] of Object.entries(parsedYaml.dimension_scores)) {
            const parsed = this.parseScore(score);
            if (parsed !== null) result.dimension_scores[dimension] = parsed;
          }
        }
      }
      
      // 提取评估理由
      if (parsedYaml.evaluation_reason) {
        // 处理字符串或数组格式的评估理由
        if (typeof parsedYaml.evaluation_reason === 'string') {
          result.evaluation_reason = parsedYaml.evaluation_reason;
        } else if (Array.isArray(parsedYaml.evaluation_reason)) {
          result.evaluation_reason = parsedYaml.evaluation_reason.join('\n');
        }
      }
      
      return result;
    } catch (error) {
      console.error('解析评估结果出错:', error);
      return { 
        overall_score: 0, 
        dimension_scores: {}, 
        evaluation_reason: '解析错误: ' + (error instanceof Error ? error.message : String(error)), 
        item_metadata: modelResponse
      };
    }
  }

  /**
   * 将分数值转换为数字，兼容 "1"、"[1]"、"1分" 等写法
   *
   * @param {any} value - 原始分数值
   * @returns {number | null} 解析出的分数，无法解析时返回null
   */
  private parseScore(value: any): number | null {
    if (Array.isArray(value)) value = value[0];
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  /**
   * YAML解析失败时，用正则兜底提取总分、维度分和评估理由
   *
   * @param {string} text - YAML文本
   * @returns {any} 与YAML解析结果结构一致的对象
   */
  private extractByRegex(text: string): any {
    const result: any = { dimension_scores: {} };

    const scoreMatch = text.match(/overall_score\s*:\s*\[?\s*(-?\d+(?:\.\d+)?)/);
    if (scoreMatch) {
      result.overall_score = Number(scoreMatch[1]);
    }

    // 维度分：取 dimension_scores 与 evaluation_reason 之间形如 "- 维度: 1" 或 "维度: 1" 的行
    const dimSection = text.match(/dimension_scores\s*:([\s\S]*?)(?=evaluation_reason\s*:|$)/);
    if (dimSection) {
      const dimRegex = /^\s*-?\s*([^:\n]+?)\s*:\s*\[?\s*(-?\d+(?:\.\d+)?)/gm;
      for (const m of dimSection[1].matchAll(dimRegex)) {
        result.dimension_scores[m[1].trim()] = Number(m[2]);
      }
    }

    const reasonMatch = text.match(/evaluation_reason\s*:\s*\|?\s*([\s\S]*)$/);
    if (reasonMatch) {
      result.evaluation_reason = reasonMatch[1].trim();
    }

    return result;
  }

  /**
   * 执行完整的评测流程
   * 
   * 处理单个评测项，包括构建提示词、调用LLM和解析结果
   * 
   * @param {any} item - 评测项
   * @param {any} test - 测试配置
   * @param {string} modelConfigId - 模型配置ID
   * @returns {Promise<any>} 评测结果
   */
  async evaluateItem(item: any, test: any, modelConfigId: string): Promise<any> {
    try {
      console.log(`处理评测项: ${item.id}`, item);
      
      // 构建提示词
      const prompt = this.buildPrompt(
        item.question_text || item.text || item.content || item.question,
        item.standard_answer || item.answer || item.reference_answer,
        item.rag_answers?.[0]?.answer || item.rag_answer || '',
        test.prompt_template
      );
      
      const startTime = performance.now();
      
      // 调用LLM进行评测
      const llmResponse = await this.evaluateWithLLM(prompt, modelConfigId);
      
      const processingTime = performance.now() - startTime;
      
      // 解析评测结果
      const { overall_score, dimension_scores, evaluation_reason, item_metadata } = this.extractEvaluationResult(llmResponse);
      
      // 构建评测项结果
      return {
        id: item.id,
        ai_score: overall_score,
        ai_dimension_scores: dimension_scores,
        ai_evaluation_reason: evaluation_reason,
        ai_evaluation_time: new Date().toISOString(),
        ai_raw_response: llmResponse,
        status: test.evaluation_type === 'ai' ? 'ai_completed' : 'ai_completed',
        processing_time: processingTime,
        item_metadata: item_metadata, // 原始回答
        ...(test.evaluation_type === 'ai' ? {
          final_score: overall_score,
          final_dimension_scores: dimension_scores,
          final_evaluation_reason: evaluation_reason,
          final_evaluation_type: 'ai'
        } : {})
      };
    } catch (error: any) {
      console.error('处理评测项失败:', error);
      return {
        id: item.id,
        status: 'failed',
        error_message: error.message
      };
    }
  }
}

// 导出单例实例
export const accuracyRequestService = new AccuracyRequestService();
