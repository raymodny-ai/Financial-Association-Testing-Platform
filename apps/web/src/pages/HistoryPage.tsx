import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { StarFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { TaskRecord, TaskStatus } from '@platform/schemas';
import { listTasks, runTask } from '../lib/api';

/** 任务状态 → AntD 预设状态色（经主题 Token 派生，不硬编码色值） */
const STATUS_META: Record<TaskStatus, { text: string; color: string }> = {
  queued: { text: '排队中', color: 'default' },
  running: { text: '运行中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  failed: { text: '失败', color: 'error' },
};

export default function HistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: ['tasks'], queryFn: listTasks });

  const rerun = useMutation({
    mutationFn: (taskId: string) => runTask(taskId),
    onSuccess: (_accepted, taskId) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // P2：202 受理即异步执行，进度在结果页轮询展示（X1）
      message.info('重新运行已启动，正在跳转结果页跟踪进度');
      navigate(`/results/${taskId}`);
    },
    onError: (error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.error(error instanceof Error ? error.message : '运行失败');
    },
  });

  const columns: ColumnsType<TaskRecord> = [
    {
      title: '项目名称',
      render: (_: unknown, record: TaskRecord) => (
        <Space size="small">
          {/* X4 收藏旗标：结果页切换，历史页展示 */}
          {record.favorited && <StarFilled style={{ color: 'var(--color-watch)' }} />}
          <span>{record.config.projectName}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: TaskStatus, record: TaskRecord) => (
        <Space size="small">
          <Tag color={STATUS_META[status].color}>{STATUS_META[status].text}</Tag>
          {status === 'failed' && record.errorMessage !== null && (
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
              {record.errorMessage}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => <span className="font-data">{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => <span className="font-data">{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: '操作',
      width: 280,
      render: (_: unknown, record: TaskRecord) => (
        <Space>
          <Button
            size="small"
            type="primary"
            disabled={record.status !== 'completed'}
            onClick={() => navigate(`/results/${record.id}`)}
          >
            查看结果
          </Button>
          <Button
            size="small"
            loading={rerun.isPending && rerun.variables === record.id}
            disabled={record.status === 'running'}
            onClick={() => rerun.mutate(record.id)}
          >
            重新运行
          </Button>
          {/* PRD 配置设计：复制分析 = 同配置预填向导，可调整后重跑 */}
          <Button size="small" onClick={() => navigate(`/?clone=${record.id}`)}>
            复制分析
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h1 className="page-title font-display">历史任务</h1>
      <Card>
        {query.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 'var(--space-4)' }}
            message="任务列表加载失败"
            description={query.error instanceof Error ? query.error.message : '未知错误'}
          />
        )}
        <Table<TaskRecord>
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={columns}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
