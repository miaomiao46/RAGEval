import React, { useEffect, useState } from 'react';
import {
  Layout, Typography, Form, Input, Switch, Select, Button, Card,
  Radio, Space, message, Divider, Tag, Tooltip, Alert
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { CreateDatasetRequest, DatasetType } from '../../../types/dataset';
import { datasetService } from '../../../services/dataset.service';
import styles from './CreateDataset.module.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

const CreateDatasetPage: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [importOption, setImportOption] = useState('empty');
  const [tags, setTags] = useState<string[]>([]);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [datasetType, setDatasetType] = useState<DatasetType>('standard');

  const navigate = useNavigate();

  const handleSubmit = async (values: any) => {

    setLoading(true);
    try {
      const datasetData: CreateDatasetRequest = {
        name: values.name,
        description: values.description,
        is_public: values.is_public,
        tags,
        dataset_type: datasetType,
        dataset_metadata: {
          created_method: importOption
        }
      };

      const result = await datasetService.createDataset(datasetData);
      
      message.success('数据集创建成功');
      
      // 如果选择了导入方式，则跳转到导入页面
      if (importOption !== 'empty') {
        navigate(`/datasets/${result.id}/import`);
      } else {
        navigate(`/datasets/${result.id}`);
      }
    } catch (error) {
      console.error('创建数据集失败:', error);
      message.error('创建数据集失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (removedTag: string) => {
    const newTags = tags.filter(tag => tag !== removedTag);
    setTags(newTags);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputConfirm = () => {
    if (inputValue && !tags.includes(inputValue)) {
      setTags([...tags, inputValue]);
    }
    setInputVisible(false);
    setInputValue('');
  };

  const showInput = () => {
    setInputVisible(true);
  };

  return (
    <Layout.Content className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <Button 
          type="text" 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate('/datasets')}
        >
          返回
        </Button>
        <Title level={2}>创建数据集</Title>
        <Text type="secondary">
          填写基本信息，创建一个新的问答数据集
        </Text>
      </div>

      <Card className={styles.formCard}>
        <Form 
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            is_public: false
          }}
        >
          <div className={styles.section}>
            <Title level={4}>基本信息</Title>
            <Text type="secondary">请填写数据集的基本信息</Text>

            <Form.Item
              name="name"
              label="数据集名称"
              rules={[{ required: true, message: '请输入数据集名称' }]}
              className={styles.formItem}
            >
              <Input placeholder="给数据集起一个名字" maxLength={100} />
            </Form.Item>

            <Form.Item
              name="description"
              label="数据集描述"
              className={styles.formItem}
            >
              <TextArea
                rows={4}
                placeholder="简单描述这个数据集的内容和用途"
                maxLength={500}
                showCount
              />
            </Form.Item>

            <Form.Item
              label="数据集类型"
              required
              className={styles.formItem}
            >
              <Radio.Group
                value={datasetType}
                onChange={(e) => setDatasetType(e.target.value)}
                style={{ width: '100%' }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Radio value="standard">
                    <Space>
                      <SearchOutlined style={{ color: '#1890ff' }} />
                      <span><strong>普通检索数据集</strong></span>
                      <Tag color="blue">easy / medium</Tag>
                    </Space>
                  </Radio>
                  <Alert
                    style={{ marginLeft: 24, marginBottom: 8 }}
                    message="测试 RAG 系统的基础检索准确性"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>问题答案可以从<strong>单一文本片段</strong>中直接找到</li>
                        <li>难度以<strong>简单（easy）和中等（medium）</strong>为主</li>
                        <li>问题类型：事实型、概念型、程序型</li>
                        <li>适用场景：知识库问答、文档检索基准测试</li>
                      </ul>
                    }
                    type="info"
                    showIcon={false}
                  />
                  <Radio value="advanced">
                    <Space>
                      <ThunderboltOutlined style={{ color: '#fa8c16' }} />
                      <span><strong>高级检索数据集</strong></span>
                      <Tag color="orange">medium / hard</Tag>
                    </Space>
                  </Radio>
                  <Alert
                    style={{ marginLeft: 24 }}
                    message="测试 RAG 系统的深度理解、推理和多跳检索能力"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>问题需要<strong>跨段落信息整合</strong>或<strong>推理归纳</strong>才能回答</li>
                        <li>难度以<strong>中等（medium）和困难（hard）</strong>为主</li>
                        <li>问题类型：推理型、归纳型、比较型</li>
                        <li>适用场景：复杂知识推理、多文档综合分析能力评测</li>
                      </ul>
                    }
                    type="warning"
                    showIcon={false}
                  />
                </Space>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              label="标签"
              className={styles.formItem}
            >
              <div className={styles.tagContainer}>
                {tags.map((tag, index) => {
                  return (
                    <Tag
                      className={styles.tag}
                      key={tag}
                      closable
                      onClose={() => handleClose(tag)}
                    >
                      {tag}
                    </Tag>
                  );
                })}
                {inputVisible ? (
                  <Input
                    type="text"
                    size="small"
                    className={styles.tagInput}
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleInputConfirm}
                    onPressEnter={handleInputConfirm}
                    autoFocus
                  />
                ) : (
                  <Tag className={styles.tagAddBtn} onClick={showInput}>
                    <PlusOutlined /> 添加标签
                  </Tag>
                )}
              </div>
              <Text type="secondary">添加标签可以帮助更好地分类和查找数据集</Text>
            </Form.Item>


            <Form.Item
              name="is_public"
              label="公开性"
              valuePropName="checked"
              className={styles.formItem}
            >
              <Switch checkedChildren="公开" unCheckedChildren="私有" />
            </Form.Item>
            <div className={styles.formItemHint}>
              <Text type="secondary">公开的数据集可以被其他用户查看和使用</Text>
            </div>
          </div>

          <Divider />


          <div className={styles.formActions}>
            <Button onClick={() => navigate('/datasets')}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>创建数据集</Button>
          </div>
        </Form>
      </Card>
    </Layout.Content>
  );
};

export default CreateDatasetPage; 