import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { UploadedFile } from '@platform/schemas';
import { deleteFile, listFiles } from '../lib/api';

/**
 * 数据集管理（X5，PRD 信息架构 Datasets）。
 * 展示已上传 CSV 的元数据（列名/行数），支持删除与跳转向导使用。
 */
export default function DatasetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: ['files'], queryFn: listFiles });

  const remove = useMutation({
    mutationFn: (fileId: string) => deleteFile(fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      message.success('文件已删除');
    },
    onError: (error: unknown) => {
      message.error(error instanceof Error ? error.message : '删除失败');
    },
  });

  const columns: ColumnsType<UploadedFile> = [
    { title: '文件名', dataIndex: 'filename', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
    {
      title: '列名',
      dataIndex: 'columns',
      render: (cols: string[]) => (
        <Space size={[4, 4]} wrap>
          {cols.map((c) => (
            <Tag key={c} className="font-data">
              {c}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: '数据行数', dataIndex: 'rowCount', width: 110, align: 'right', render: (v: number) => <span className="font-data">{v}</span> },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => <span className="font-data">{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: '操作',
      width: 200,
      render: (_: unknown, record: UploadedFile) => (
        <Space>
          <Button size="small" type="primary" onClick={() => navigate('/')}>
            去新建分析使用
          </Button>
          <Popconfirm
            title="删除该数据集？"
            description="引用该文件的既有任务重跑时将报缺文件，删除不可恢复。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => remove.mutate(record.id)}
          >
            <Button size="small" danger loading={remove.isPending && remove.variables === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h1 className="page-title font-display">数据集</h1>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 'var(--space-4)' }}
        message="CSV 上传在新建分析向导的数据源步骤完成；本页负责已上传文件的查看与删除。"
      />
      <Card>
        <Table<UploadedFile>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={query.data ?? []}
          loading={query.isLoading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty description="尚未上传数据集，请在「新建分析」向导中选择 CSV 上传作为数据源" />
            ),
          }}
        />
      </Card>
    </div>
  );
}
