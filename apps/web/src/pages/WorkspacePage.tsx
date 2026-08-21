import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Descriptions, Row, Statistic, Typography } from 'antd';
import { listFiles, listTasks, listTemplates } from '../lib/api';

/**
 * 工作区总览（X5，PRD 信息架构首项）。
 * G5 决策：MVP 匿名工作区，归属由服务端 httpOnly Cookie 决定；
 * 本页以既有列表 API 聚合出计数概览与功能入口。
 */
export default function WorkspacePage() {
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: listTasks });
  const filesQuery = useQuery({ queryKey: ['files'], queryFn: listFiles });
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: listTemplates });

  const tasks = tasksQuery.data ?? [];
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div>
      <h1 className="page-title font-display">工作区</h1>
      <Row gutter={16}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="分析任务" value={tasks.length} loading={tasksQuery.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已完成" value={completedCount} loading={tasksQuery.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="上传数据集" value={(filesQuery.data ?? []).length} loading={filesQuery.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="分析模板" value={(templatesQuery.data ?? []).length} loading={templatesQuery.isLoading} />
          </Card>
        </Col>
      </Row>
      <Card style={{ marginTop: 'var(--space-4)' }}>
        <Typography.Title level={4} className="font-display">
          功能入口
        </Typography.Title>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="新建分析">
            <Link to="/">五步向导：数据源 → 期间 → 检验配置 → 预览 → 运行</Link>
          </Descriptions.Item>
          <Descriptions.Item label="数据集">
            <Link to="/datasets">管理已上传的 CSV 文件</Link>
          </Descriptions.Item>
          <Descriptions.Item label="分析结果">
            <Link to="/results">查看已完成任务的检验结果与审计</Link>
          </Descriptions.Item>
          <Descriptions.Item label="报告">
            <Link to="/reports">一键导出完整研究报告（15_full_report.html）</Link>
          </Descriptions.Item>
          <Descriptions.Item label="工作区归属">
            匿名工作区（MVP）：归属由服务端 Cookie 决定，T27 引入账户体系
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
