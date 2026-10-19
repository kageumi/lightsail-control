export const actionLabels = {
  "rotate-ip": "更换 IP",
  start: "开机",
  stop: "关机",
};
const regions: Record<string, string> = {
  "ap-southeast-1": "新加坡",
  "ap-northeast-1": "东京",
  "ap-northeast-2": "首尔",
  "ap-southeast-2": "悉尼",
  "ap-south-1": "孟买",
  "us-east-1": "弗吉尼亚",
  "us-east-2": "俄亥俄",
  "us-west-2": "俄勒冈",
  "eu-west-1": "爱尔兰",
  "eu-west-2": "伦敦",
  "eu-central-1": "法兰克福",
  "ca-central-1": "加拿大",
};
export const regionLabel = (region: string) => regions[region] ?? region;
export const stateLabel = (state: string) =>
  ({
    running: "运行中",
    stopped: "已停止",
    stopping: "正在停止",
    pending: "正在启动",
    shutting_down: "正在关闭",
    terminated: "已终止",
  })[state] ?? state;
export const dateLabel = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
