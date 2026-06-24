import React, { useState, useEffect } from 'react';
import {
  Form, Input, Button, Select, InputNumber, Space,
  Progress, message, Table, Tag, Alert, Divider,
  Typography, Radio, Tooltip, Card, Row, Col, Collapse,
} from 'antd';
import {
  ThunderboltOutlined, InfoCircleOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { LLMClient } from '../../../Settings/LLMTemplates/llm-request';
import { ConfigManager, ModelConfig } from '@utils/configManager';
import { datasetService } from '../../../../services/dataset.service';
import { api } from '../../../../utils/api';

const { Title, Text, Paragraph } = Typography;

// ── 提示词模板 ────────────────────────────────────────────────────────────────

const SINGLE_DOC_PROMPT = `你是一个专业的问答对生成专家。请根据以下文本内容生成 1 个高质量的问答对。
要求：
1. 问题清晰明确，有实际意义
2. 答案准确完整，完全基于所给文本
3. 严格按照以下 JSON 格式返回，不要包含任何其他内容：
{"question": "问题内容", "answer": "答案内容"}

文本内容：
{{chunk_content}}`;

const CROSS_DOC_PROMPT = `你是一个专业的问答对生成专家。请根据以下来自不同文档的多个文本片段，生成 1 个需要综合多个文档信息才能完整回答的跨文档问答对。
要求：
1. 问题必须需要整合多个文档的信息才能回答，不能仅凭单一片段就能回答
2. 答案准确全面，综合了所有相关文档的内容
3. 严格按照以下 JSON 格式返回，不要包含任何其他内容：
{"question": "问题内容", "answer": "答案内容"}

文档片段：
{{chunks_content}}`;

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface DifyChunk {
  doc_id: string;
  doc_name: string;
  chunk_content: string;
  chunk_id?: string;
}

interface GeneratedItem {
  key: number;
  question: string;
  answer: string;
  docs: string[];
  status: 'pending' | 'generating' | 'success' | 'failed';
  error?: string;
}

interface DifyQAGenerationProps {
  datasetId: string;
  onGenerationComplete?: () => void;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function parseQAResponse(response: string): { question: string; answer: string } | null {
  // 先找 JSON 块
  const jsonMatch = response.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]);
      if (data.question && data.answer) return { question: data.question, answer: data.answer };
    } catch {
      // ignore
    }
  }
  // 回退：找 "question" / "answer" 行
  const qMatch = response.match(/[\"']?question[\"']?\s*[:：]\s*[\"']?([^\n"']+)[\"']?/i);
  const aMatch = response.match(/[\"']?answer[\"']?\s*[:：]\s*[\"']?([^\n"']+)[\"']?/i);
  if (qMatch?.[1] && aMatch?.[1]) {
    return { question: qMatch[1].trim(), answer: aMatch[1].trim() };
  }
  return null;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

const DifyQAGeneration: React.FC<DifyQAGenerationProps> = ({ datasetId, onGenerationComplete }) => {
  const [form] = Form.useForm();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [generationType, setGenerationType] = useState<'single_doc' | 'cross_doc'>('single_doc');

  const [isPreparing, setIsPreparing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [groups, setGroups] = useState<DifyChunk[][]>([]);
  const [docCount, setDocCount] = useState(0);
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    ConfigManager.getInstance()
      .getAllConfigs<ModelConfig>('model')
      .then(setModels);
  }, []);

  // 第一步：调用后端获取 chunks
  const handlePrepare = async () => {
    try {
      await form.validateFields(['dify_base_url', 'dify_api_key']);
    } catch {
      return;
    }

    const values = form.getFieldsValue();
    setIsPreparing(true);
    try {
      const resp = await api.post<{ generation_type: string; groups: DifyChunk[][]; doc_count: number }>(
        `/v1/datasets-questions/${datasetId}/dify/chunks`,
        {
          dify_base_url: values.dify_base_url,
          dify_api_key: values.dify_api_key,
          dify_knowledge_id: values.dify_knowledge_id,
          generation_type: generationType,
          count: values.count ?? 5,
        }
      );

      setGroups(resp.groups);
      setDocCount(resp.doc_count);

      const initialItems: GeneratedItem[] = resp.groups.map((g, i) => ({
        key: i,
        question: '',
        answer: '',
        docs: g.map((c) => c.doc_name),
        status: 'pending',
      }));
      setItems(initialItems);
      setProgress({ current: 0, total: resp.groups.length });

      if (resp.groups.length === 0) {
        message.warning('未获取到有效的文档片段，请检查知识库 ID 及文档状态');
      } else {
        message.success(
          `已从 ${resp.doc_count} 个文档中准备好 ${resp.groups.length} 组片段，可以开始生成`
        );
      }
    } catch (err: any) {
      message.error(err?.message || '获取文档片段失败');
    } finally {
      setIsPreparing(false);
    }
  };

  // 第二步：用 LLM 逐组生成 Q&A 并保存
  const handleGenerate = async () => {
    const values = form.getFieldsValue();
    if (!values.model_id) {
      message.error('请先选择大模型');
      return;
    }
    if (groups.length === 0) {
      message.error('请先点击「获取文档片段」');
      return;
    }

    let llmClient: LLMClient;
    try {
      llmClient = await LLMClient.createFromConfigId(values.model_id);
    } catch {
      message.error('模型配置加载失败，请检查设置');
      return;
    }

    setIsGenerating(true);
    setProgress({ current: 0, total: groups.length });

    const updatedItems: GeneratedItem[] = items.map((it) => ({ ...it, status: 'pending' as GeneratedItem['status'] }));
    setItems([...updatedItems]);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      // 标记当前生成中
      updatedItems[i] = { ...updatedItems[i], status: 'generating' as GeneratedItem['status'] };
      setItems([...updatedItems]);

      let prompt: string;
      if (generationType === 'single_doc') {
        prompt = SINGLE_DOC_PROMPT.replace('{{chunk_content}}', group[0].chunk_content);
      } else {
        const chunksText = group
          .map((c) => `【文档：${c.doc_name}】\n${c.chunk_content}`)
          .join('\n\n---\n\n');
        prompt = CROSS_DOC_PROMPT.replace('{{chunks_content}}', chunksText);
      }

      try {
        const response = await llmClient.chatCompletion({ userMessage: prompt });
        const qa = parseQAResponse(response);

        if (qa) {
          await datasetService.createQuestion(datasetId, {
            question_text: qa.question,
            standard_answer: qa.answer,
            category: generationType === 'cross_doc' ? 'comparative' : 'factoid',
            difficulty: generationType === 'cross_doc' ? 'hard' : 'easy',
            type: generationType === 'cross_doc' ? 'cross_doc' : 'single_doc',
            question_metadata: {
              source_docs: group.map((c) => c.doc_name),
              generation_method: 'dify',
            },
          });

          updatedItems[i] = { ...updatedItems[i], question: qa.question, answer: qa.answer, status: 'success' as GeneratedItem['status'] };
        } else {
          updatedItems[i] = { ...updatedItems[i], status: 'failed' as GeneratedItem['status'], error: '无法解析模型返回的 JSON' };
        }
      } catch (err: any) {
        updatedItems[i] = { ...updatedItems[i], status: 'failed' as GeneratedItem['status'], error: err.message };
      }

      setItems([...updatedItems]);
      setProgress({ current: i + 1, total: groups.length });
    }

    setIsGenerating(false);
    const successCount = updatedItems.filter((it) => it.status === 'success').length;
    message.success(`生成完成：${successCount} 成功 / ${groups.length} 总计`);
    if (successCount > 0) onGenerationComplete?.();
  };

  const successCount = items.filter((it) => it.status === 'success').length;
  const failedCount = items.filter((it) => it.status === 'failed').length;
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{ maxWidth: 860 }}>
      <Form form={form} layout="vertical" initialValues={{ count: 5 }}>
        {/* ── Dify 配置 ─────────────────────────────────── */}
        <Title level={5} style={{ marginBottom: 12 }}>
          Dify 知识库配置
        </Title>

        <Row gutter={16}>
          <Col span={14}>
            <Form.Item
              name="dify_base_url"
              label="Dify 服务地址"
              rules={[{ required: true, message: '请输入 Dify API 地址' }]}
              tooltip="Knowledge API 基础 URL，例如 http://your-dify-host/v1"
            >
              <Input placeholder="http://your-dify-host/v1" />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item
              name="dify_api_key"
              label="Dify API Key"
              rules={[{ required: true, message: '请输入 API Key' }]}
            >
              <Input.Password placeholder="Dataset API Key" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="dify_knowledge_id"
          label="知识库 ID（可选）"
          tooltip="Dify 知识库的 UUID，可在知识库设置页面找到；留空则使用该 API Key 下所有知识库"
        >
          <Input placeholder="留空则使用所有知识库（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）" />
        </Form.Item>

        <Divider />

        {/* ── 生成配置 ─────────────────────────────────── */}
        <Title level={5} style={{ marginBottom: 12 }}>
          生成配置
        </Title>

        <Form.Item name="generation_type" label="生成模式">
          <Radio.Group
            value={generationType}
            onChange={(e) => {
              setGenerationType(e.target.value);
              setGroups([]);
              setItems([]);
            }}
          >
            <Radio.Button value="single_doc">
              单文档问答对
              <Tooltip title="基于全量知识库，每个文档取一个 chunk 各自生成一对 Q&A">
                <InfoCircleOutlined style={{ marginLeft: 4 }} />
              </Tooltip>
            </Radio.Button>
            <Radio.Button value="cross_doc">
              跨文档问答对
              <Tooltip title="随机组合多个文档（最多 5 个），综合生成一对跨文档 Q&A">
                <InfoCircleOutlined style={{ marginLeft: 4 }} />
              </Tooltip>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        {generationType === 'cross_doc' && (
          <Form.Item
            name="count"
            label="生成数量"
            rules={[{ required: true, type: 'number', min: 1, max: 200, message: '请输入 1~200 的整数' }]}
          >
            <InputNumber min={1} max={200} style={{ width: 120 }} addonAfter="对" />
          </Form.Item>
        )}

        <Form.Item
          name="model_id"
          label="大模型"
          rules={[{ required: true, message: '请选择大模型' }]}
          tooltip="用于生成问答对的 LLM，需在「设置」中预先配置"
        >
          <Select placeholder="选择用于生成的大模型" style={{ maxWidth: 360 }}>
            {models.map((m) => (
              <Select.Option key={m.id} value={m.id}>
                {m.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        {/* ── 操作按钮 ─────────────────────────────────── */}
        <Space>
          <Button
            type="default"
            icon={<ThunderboltOutlined />}
            onClick={handlePrepare}
            loading={isPreparing}
            disabled={isGenerating}
          >
            获取文档片段
          </Button>

          {groups.length > 0 && (
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={isGenerating}
              disabled={isPreparing}
            >
              开始生成
            </Button>
          )}
        </Space>
      </Form>

      {/* ── 状态提示 ──────────────────────────────────────────────────────────── */}
      {groups.length > 0 && !isGenerating && items.every((it) => (it.status as string) === 'pending') && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={`已准备 ${groups.length} 组文档片段（知识库共 ${docCount} 个可用文档），点击「开始生成」`}
        />
      )}

      {(isGenerating || progress.current > 0) && (
        <Card size="small" style={{ marginTop: 16 }}>
          <Progress
            percent={percent}
            status={isGenerating ? 'active' : failedCount > 0 ? 'exception' : 'success'}
          />
          <Text type="secondary">
            {progress.current} / {progress.total}
            {successCount > 0 && <Text style={{ color: '#52c41a', marginLeft: 8 }}>✓ {successCount} 成功</Text>}
            {failedCount > 0 && <Text type="danger" style={{ marginLeft: 8 }}>✗ {failedCount} 失败</Text>}
          </Text>
        </Card>
      )}

      {/* ── 结果列表 ──────────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <Table<GeneratedItem>
          style={{ marginTop: 16 }}
          dataSource={items}
          rowKey="key"
          size="small"
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (s, record) => {
                if (s === 'success') return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
                if (s === 'failed') return <Tooltip title={record.error}><Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag></Tooltip>;
                if (s === 'generating') return <Tag icon={<LoadingOutlined />} color="processing">生成中</Tag>;
                return <Tag>待生成</Tag>;
              },
            },
            {
              title: '来源文档',
              dataIndex: 'docs',
              width: 180,
              ellipsis: true,
              render: (docs: string[]) => (
                <Tooltip title={docs.join('、')}>
                  <span>{docs.join('、')}</span>
                </Tooltip>
              ),
            },
            {
              title: '问题',
              dataIndex: 'question',
              ellipsis: true,
              render: (q) => q || <Text type="secondary">-</Text>,
            },
            {
              title: '答案',
              dataIndex: 'answer',
              ellipsis: true,
              render: (a) => a || <Text type="secondary">-</Text>,
            },
          ]}
          expandable={{
            expandedRowRender: (record) =>
              record.status === 'success' ? (
                <div style={{ padding: '8px 0' }}>
                  <Paragraph strong>问题：</Paragraph>
                  <Paragraph>{record.question}</Paragraph>
                  <Paragraph strong>答案：</Paragraph>
                  <Paragraph>{record.answer}</Paragraph>
                  <Paragraph type="secondary">来源：{record.docs.join('、')}</Paragraph>
                </div>
              ) : null,
            rowExpandable: (record) => record.status === 'success',
          }}
        />
      )}
    </div>
  );
};

export default DifyQAGeneration;
