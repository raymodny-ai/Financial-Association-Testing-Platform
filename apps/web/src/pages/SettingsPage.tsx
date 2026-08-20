import { Card, Descriptions, Typography } from 'antd';

/**
 * 设置占位。
 * G5 决策：MVP 匿名工作区，此页展示工作区 ID；T27 引入正式账户体系。
 */
export default function SettingsPage() {
  return (
    <Card>
      <Typography.Title level={3} className="font-display">
        设置
      </Typography.Title>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="用户模型">匿名工作区（MVP，T27 引入账户体系）</Descriptions.Item>
        <Descriptions.Item label="默认 LLM 提供方">Qwen / DeepSeek（OpenAI 兼容协议）</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
