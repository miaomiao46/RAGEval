import React, { useEffect, useState } from 'react';
import {
  Modal, Typography, Form, Input, Switch, Button, Tag, message, Radio, Space
} from 'antd';
import { PlusOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Dataset, UpdateDatasetRequest, DatasetType } from '../../../types/dataset';
import { datasetService } from '../../../services/dataset.service';

const { Text } = Typography;
const { TextArea } = Input;

interface EditDatasetModalProps {
  visible: boolean; // For backward compatibility
  open?: boolean;
  dataset: Dataset | null;
  onCancel: () => void;
  onSuccess: () => void;
}

const EditDatasetModal: React.FC<EditDatasetModalProps> = ({
  visible,
  open,
  dataset,
  onCancel,
  onSuccess
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [datasetType, setDatasetType] = useState<DatasetType>('standard');

  // 当数据集变化时，重置表单
  useEffect(() => {
    if (dataset && (visible || open)) {
      form.setFieldsValue({
        name: dataset.name,
        description: dataset.description || '',
        is_public: dataset.is_public
      });
      setTags(dataset.tags || []);
      setDatasetType(dataset.dataset_type || 'standard');
    }
  }, [dataset, visible, open, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const updateData: UpdateDatasetRequest = {
        name: values.name,
        description: values.description,
        is_public: values.is_public,
        tags: tags,
        dataset_type: datasetType
      };

      if (dataset) {
        await datasetService.updateDataset(dataset.id, updateData);
        message.success('数据集更新成功');
        onSuccess();
      }
    } catch (error) {
      console.error('更新数据集失败:', error);
      message.error('更新数据集失败，请重试');
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
    <Modal
      title="编辑数据集"
      open={open !== undefined ? open : visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={loading}
          onClick={handleSubmit}
        >
          保存
        </Button>
      ]}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item
          name="name"
          label="数据集名称"
          rules={[{ required: true, message: '请输入数据集名称' }]}
        >
          <Input placeholder="给数据集起一个名字" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label="数据集描述"
        >
          <TextArea
            rows={4}
            placeholder="简单描述这个数据集的内容和用途"
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item
          label="标签"
        >
          <div style={{ marginBottom: 8 }}>
            {tags.map((tag) => (
              <Tag
                key={tag}
                closable
                onClose={() => handleClose(tag)}
                style={{ marginBottom: 8 }}
              >
                {tag}
              </Tag>
            ))}
            {inputVisible ? (
              <Input
                type="text"
                size="small"
                style={{ width: 100 }}
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleInputConfirm}
                onPressEnter={handleInputConfirm}
                autoFocus
              />
            ) : (
              <Tag onClick={showInput} style={{ cursor: 'pointer' }}>
                <PlusOutlined /> 添加标签
              </Tag>
            )}
          </div>
          <Text type="secondary">添加标签可以帮助更好地分类和查找数据集</Text>
        </Form.Item>

        <Form.Item label="数据集类型">
          <Radio.Group value={datasetType} onChange={(e) => setDatasetType(e.target.value)}>
            <Space direction="vertical">
              <Radio value="standard">
                <Space>
                  <SearchOutlined style={{ color: '#1890ff' }} />
                  <strong>普通检索</strong>
                  <Tag color="blue">easy / medium</Tag>
                  <Text type="secondary">— 直接事实检索，单一段落可答</Text>
                </Space>
              </Radio>
              <Radio value="advanced">
                <Space>
                  <ThunderboltOutlined style={{ color: '#fa8c16' }} />
                  <strong>高级检索</strong>
                  <Tag color="orange">medium / hard</Tag>
                  <Text type="secondary">— 推理/归纳/多跳检索</Text>
                </Space>
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="is_public"
          label="公开性"
          valuePropName="checked"
        >
          <Switch checkedChildren="公开" unCheckedChildren="私有" />
        </Form.Item>
        <div style={{ marginTop: -15, marginBottom: 15 }}>
          <Text type="secondary">公开的数据集可以被其他用户查看和使用</Text>
        </div>
      </Form>
    </Modal>
  );
};

export default EditDatasetModal;
