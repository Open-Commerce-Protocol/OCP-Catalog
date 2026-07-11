#!/usr/bin/env bash
set -euo pipefail

payload='{"ocp_version":"1.0","kind":"CatalogQueryRequest","catalog_id":"cat_ocp_domestic_jobs_prod","query_pack":"ocp.job.domestic.match_candidate.v1","query_mode":"hybrid","filters":{"city":"杭州","recruitment_type":"campus","matching_mode":"computer"},"candidate_profile":{"basic_info":{"work_years":0,"highest_degree":"bachelor","current_city":"杭州","current_title":"软件工程本科生","summary":"软件工程本科在读，关注深度学习、AI Agent、协议和企业智能化系统，具备 Go、Python、Java、Bazel 与多 Agent 系统工程经验。"},"target":{"recruitment_type":"campus","cities":["杭州"],"job_families":["algorithm","backend","software_engineering"]},"skills":[{"name":"AI Agent","level":"advanced"},{"name":"深度学习","level":"advanced"},{"name":"Go","level":"advanced"},{"name":"Python","level":"advanced"},{"name":"Java","level":"intermediate"},{"name":"Bazel","level":"intermediate"},{"name":"机器学习","level":"advanced"},{"name":"分布式系统","level":"intermediate"}],"work_experiences":[{"title":"AI 系统与招聘匹配平台开发","description":"构建能力评估、简历分析、岗位匹配、多 Agent 工作流与 HR 决策辅助。","tech_stack":["Go","Python","AI Agent","语义检索"]}],"projects":[{"name":"OCP","role":"协议与语义检索设计","description":"设计面向 Agent 的对象发现、语义检索、结构化筛选、约束对齐与协商。","tech_stack":["协议设计","语义检索","Agent"]},{"name":"统一知识蒸馏","role":"共同第一作者","description":"研究离线、在线与自蒸馏统一建模，参与训练和实验验证。","tech_stack":["深度学习","知识蒸馏"]}],"educations":[{"school":"浙江工业大学","degree":"bachelor","major":"软件工程"}],"tags":[{"name":"AI Agent","category":"tech"}]},"limit":10,"offset":0,"explain":false}'

for attempt in $(seq 1 12); do
  curl --max-time 35 -sS -o /dev/null \
    -w "${attempt} %{http_code} %{time_total}\n" \
    -H 'content-type: application/json' \
    --data "$payload" \
    http://127.0.0.1:4310/ocp/query
done
