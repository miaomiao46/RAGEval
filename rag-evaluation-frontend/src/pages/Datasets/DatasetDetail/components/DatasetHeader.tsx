import React from 'react';
import { Typography, Button, Tag, Space, Dropdown, Menu, Tooltip } from 'antd';
import {
  EditOutlined, DeleteOutlined, DownloadOutlined,
  UploadOutlined, EyeOutlined, LockOutlined,
  SearchOutlined, ThunderboltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { DatasetDetail } from '../../../../types/dataset';
import styles from '../DatasetDetail.module.css';

const { Title, Text, Paragraph } = Typography;

interface DatasetHeaderProps {
  dataset: DatasetDetail;
  isOwner: boolean;
  onEditDataset: () => void;
  onDeleteDataset: () => void;
  onImportData: () => void;
  onExportData: () => void;
}

const DatasetHeader: React.FC<DatasetHeaderProps> = ({
  dataset,
  isOwner,
  onEditDataset,
  onDeleteDataset,
  onImportData,
  onExportData
}) => {
  const navigate = useNavigate();

  return (
    <div className={styles.pageHeader}>
      <div className={styles.titleSection}>
        <div className={styles.titleInfo}>
          <Title level={2}>{dataset.name}</Title>
          <div className={styles.titleMeta}>
            {/* 数据集类型标签 */}
            {dataset.dataset_type === 'advanced' ? (
              <Tooltip title="高级检索数据集：包含需要推理、归纳或跨文档整合的问题（medium/hard难度为主）">
                <Tag color="orange" icon={<ThunderboltOutlined />}>高级检索</Tag>
              </Tooltip>
            ) : (
              <Tooltip title="普通检索数据集：问题答案可从单一文本片段直接找到（easy/medium难度为主）">
                <Tag color="blue" icon={<SearchOutlined />}>普通检索</Tag>
              </Tooltip>
            )}
            {dataset.is_public ? (
              <Tag color="green" icon={<EyeOutlined />}>公开</Tag>
            ) : (
              <Tag color="default" icon={<LockOutlined />}>私有</Tag>
            )}
            <Text type="secondary">
              {dataset.question_count} 个问题 | 创建于 {new Date(dataset.created_at).toLocaleDateString()}
            </Text>
          </div>
        </div>
        <div className={styles.actionButtons}>
          <Space>
            {isOwner ? (
              /* 所有者可以编辑和删除 */
              <>
                <Button 
                  icon={<EditOutlined />} 
                  onClick={onEditDataset}
                >
                  编辑
                </Button>
                <Button 
                  icon={<DeleteOutlined />} 
                  danger
                  onClick={onDeleteDataset}
                >
                  删除
                </Button>
                <Dropdown 
                  overlay={
                    <Menu>
                      <Menu.Item key="import" icon={<UploadOutlined />} onClick={onImportData}>
                        导入数据
                      </Menu.Item>
                      <Menu.Item key="export" icon={<DownloadOutlined />} onClick={onExportData}>
                        导出数据
                      </Menu.Item>
                    </Menu>
                  }
                >
                  <Button>
                    更多 <DownloadOutlined />
                  </Button>
                </Dropdown>
              </>
            ) : (
              /* 非所有者只能查看和导出 */
              <>
                <Button 
                  icon={<DownloadOutlined />} 
                  onClick={onExportData}
                >
                  导出数据
                </Button>
              </>
            )}
          </Space>
        </div>
      </div>
      
      {dataset.description && (
        <Paragraph className={styles.description}>
          {dataset.description}
        </Paragraph>
      )}
      
      {dataset.tags && dataset.tags.length > 0 && (
        <div className={styles.tags}>
          {dataset.tags.map((tag, index) => (
            <Tag key={index} color="blue">{tag}</Tag>
          ))}
        </div>
      )}
    </div>
  );
};

export default DatasetHeader;
