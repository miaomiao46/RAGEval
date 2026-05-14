import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Layout, Typography, Card, Row, Col, Table, Tag, Statistic,
  Divider, Button, Space, Spin, Empty, Descriptions, message
} from 'antd';
import {
  ArrowLeftOutlined, DownloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  ExperimentOutlined, RocketOutlined
} from '@ant-design/icons';
import { accuracyService, AccuracyTest } from '@services/accuracy/accuracy.service';
import { performanceService, PerformanceTest } from '@services/performance/performance.service';
import { projectService } from '@services/project.service';

const { Title, Text } = Typography;

const statusTag = (status: string) => {
  const map: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
    running:   { color: 'processing', label: '运行中', icon: <SyncOutlined spin /> },
    failed:    { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
    created:   { color: 'default', label: '待开始', icon: null },
  };
  const cfg = map[status] || { color: 'default', label: status, icon: null };
  return <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>;
};

const fmt = (v: any, decimals = 2) =>
  v != null && v !== '' ? Number(v).toFixed(decimals) : '—';

export const ProjectReportsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<any>(null);
  const [accuracyTests, setAccuracyTests] = useState<AccuracyTest[]>([]);
  const [perfTests, setPerfTests] = useState<PerformanceTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      projectService.getProjectDetails(id).catch(() => null),
      accuracyService.getByProject(id).catch(() => []),
      performanceService.getByProject(id).catch(() => []),
    ]).then(([proj, acc, perf]) => {
      setProject(proj);
      setAccuracyTests(acc as AccuracyTest[]);
      setPerfTests(perf as PerformanceTest[]);
    }).finally(() => setLoading(false));
  }, [id]);

  // ---- 导出报告为 CSV ----
  const exportReport = () => {
    const lines: string[] = [];

    lines.push('=== 准确度测试 ===');
    lines.push(['测试名称','版本','状态','评测类型','总题数','成功数','综合得分'].join(','));
    accuracyTests.forEach(t => {
      lines.push([
        `"${t.name}"`,
        t.version || '',
        t.status,
        t.evaluation_type,
        t.total_questions,
        t.success_questions,
        t.results_summary?.overall_score != null ? fmt(t.results_summary.overall_score) : '',
      ].join(','));
    });

    lines.push('');
    lines.push('=== 性能测试 ===');
    lines.push(['测试名称','版本','状态','并发数','总题数','成功率','首次响应均值(秒)','总响应均值(秒)','每秒请求数'].join(','));
    perfTests.forEach(t => {
      const m = t.summary_metrics || {};
      lines.push([
        `"${t.name}"`,
        t.version || '',
        t.status,
        t.concurrency,
        t.total_questions,
        m.success_rate != null ? `${(m.success_rate * 100).toFixed(2)}%` : '',
        m.response_time?.first_token_time?.avg != null ? fmt(m.response_time.first_token_time.avg, 3) : '',
        m.response_time?.total_time?.avg != null ? fmt(m.response_time.total_time.avg, 3) : '',
        m.throughput?.requests_per_second != null ? fmt(m.throughput.requests_per_second, 3) : '',
      ].join(','));
    });

    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `评测报告_${project?.name || id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('报告已导出');
  };

  // ---- 准确度测试列 ----
  const accColumns = [
    { title: '测试名称', dataIndex: 'name', key: 'name' },
    { title: '版本', dataIndex: 'version', key: 'version', render: (v: string) => v || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', render: statusTag },
    { title: '评测类型', dataIndex: 'evaluation_type', key: 'et',
      render: (v: string) => ({ ai: 'AI评测', manual: '人工评测', hybrid: '混合评测' }[v] || v) },
    { title: '总题数', dataIndex: 'total_questions', key: 'tq' },
    { title: '成功数', dataIndex: 'success_questions', key: 'sq' },
    {
      title: '综合得分',
      key: 'score',
      render: (_: any, r: AccuracyTest) => {
        const s = r.results_summary?.overall_score;
        return s != null ? (
          <Text strong style={{ color: s >= 0.7 ? '#52c41a' : s >= 0.4 ? '#faad14' : '#ff4d4f' }}>
            {(s * 100).toFixed(1)}%
          </Text>
        ) : '—';
      },
    },
    {
      title: '完成时间', dataIndex: 'completed_at', key: 'ca',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—',
    },
  ];

  // ---- 性能测试列 ----
  const perfColumns = [
    { title: '测试名称', dataIndex: 'name', key: 'name' },
    { title: '版本', dataIndex: 'version', key: 'version', render: (v: string) => v || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', render: statusTag },
    { title: '并发数', dataIndex: 'concurrency', key: 'concurrency' },
    { title: '总题数', dataIndex: 'total_questions', key: 'tq' },
    {
      title: '成功率',
      key: 'sr',
      render: (_: any, r: PerformanceTest) => {
        const sr = r.summary_metrics?.success_rate;
        return sr != null ? `${(sr * 100).toFixed(1)}%` : '—';
      },
    },
    {
      title: '首次响应均值',
      key: 'frt',
      render: (_: any, r: PerformanceTest) => {
        const v = r.summary_metrics?.response_time?.first_token_time?.avg;
        return v != null ? `${fmt(v, 3)}秒` : '—';
      },
    },
    {
      title: '总响应均值',
      key: 'trt',
      render: (_: any, r: PerformanceTest) => {
        const v = r.summary_metrics?.response_time?.total_time?.avg;
        return v != null ? `${fmt(v, 3)}秒` : '—';
      },
    },
    {
      title: '每秒请求数',
      key: 'rps',
      render: (_: any, r: PerformanceTest) => {
        const v = r.summary_metrics?.throughput?.requests_per_second;
        return v != null ? fmt(v, 3) : '—';
      },
    },
    {
      title: '完成时间', dataIndex: 'completed_at', key: 'ca',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—',
    },
  ];

  // ---- 汇总卡片数据 ----
  const completedAcc = accuracyTests.filter(t => t.status === 'completed');
  const completedPerf = perfTests.filter(t => t.status === 'completed');
  const avgScore = completedAcc.length
    ? completedAcc.reduce((s, t) => s + (t.results_summary?.overall_score ?? 0), 0) / completedAcc.length
    : null;
  const avgRps = completedPerf.length
    ? completedPerf.reduce((s, t) => s + (t.summary_metrics?.throughput?.requests_per_second ?? 0), 0) / completedPerf.length
    : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout.Content style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/projects/${id}`)}>
            返回项目
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            评测报告{project ? ` — ${project.name}` : ''}
          </Title>
        </Space>
        <Button type="primary" icon={<DownloadOutlined />} onClick={exportReport}>
          导出报告 CSV
        </Button>
      </div>

      {/* 汇总统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="准确度测试总数"
              value={accuracyTests.length}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已完成准确度测试"
              value={completedAcc.length}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均综合得分"
              value={avgScore != null ? (avgScore * 100).toFixed(1) : '—'}
              suffix={avgScore != null ? '%' : ''}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均每秒请求数"
              value={avgRps != null ? avgRps.toFixed(2) : '—'}
              prefix={<RocketOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 准确度测试 */}
      <Divider orientation="left">准确度测试</Divider>
      {accuracyTests.length === 0 ? (
        <Empty description="暂无准确度测试" />
      ) : (
        <Table
          dataSource={accuracyTests}
          columns={accColumns}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 900 }}
        />
      )}

      {/* 性能测试 */}
      <Divider orientation="left" style={{ marginTop: 32 }}>性能测试</Divider>
      {perfTests.length === 0 ? (
        <Empty description="暂无性能测试" />
      ) : (
        <Table
          dataSource={perfTests}
          columns={perfColumns}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 1100 }}
        />
      )}
    </Layout.Content>
  );
};

export default ProjectReportsPage;
