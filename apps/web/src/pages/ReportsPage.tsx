import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { TaskRecord } from '@platform/schemas';
import { getTaskResults, listTasks } from '../lib/api';
import { export15FullReport } from '../lib/export-report';

/**
 * 报告导出（X5，PRD 信息架构 Reports + PRD「报告输出」）。
 * 列出已完成任务，一键客户端生成 15_full_report.html（复用导出规范纯函数，无需服务端）。
 */
export default function ReportsPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['tasks'], queryFn: listTasks });

  const completed = (query.data ?? []).filter((t) => t.status === 'completed');

  const exportReport = useMutation({
    mutationFn: async (taskId: string) => {
      const data = await getTaskResults(taskId);
      export15FullReport(data);
    },
    onSuccess: () => message.success('报告已生成并开始下载'),
    onError: (error: unknown) => {
      message.error(error instanceof Error ? error.message : '报告生成失败');
    },
  });

  const columns: ColumnsType<TaskRecord> = [
    {
      title: '项目名称',
      render: (_: unknown, record: TaskRecord) => (
        <Space size="small">
          <Typography.Text strong>{record.config.projectName}</Typography.Text>
          <Tag>{record.config.frequency === 'daily' ? '日频' : record.config.frequency === 'weekly' ? '周频' : '月频'}</Tag>
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => <span className="font-data">{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: '操作',
      width: 260,
      render: (_: unknown, record: TaskRecord) => (
        <Space>
          <Button
            size="small"
            type="primary"
            loading={exportReport.isPending && exportReport.variables === record.id}
            onClick={() => exportReport.mutate(record.id)}
          >
            导出完整报告
          </Button>
          <Button size="small" onClick={() => navigate(`/results/${record.id}`)}>
            查看结果
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h1 className="page-title font-display">报告</h1>
      <Card>
        <Table<TaskRecord>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={completed}
          loading={query.isLoading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                description={
                  <>
                    暂无已完成任务，请先 <Link to="/">新建分析</Link> 并在完成后回到本页导出报告
                  </>
                }
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
