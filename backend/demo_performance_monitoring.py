"""
工作流性能监控演示
展示完整的性能监控功能包括指标收集、告警、分析等
"""

import asyncio
import time
import json
from datetime import datetime
from typing import Dict, Any

from app.schemas.workflow import (
    WorkflowDefinition,
    WorkflowNode,
    WorkflowEdge,
    NodeFunctionSignature,
    NodeInputSchema,
    NodeOutputSchema,
    DataType
)
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_performance_monitor import (
    workflow_performance_monitor,
    AlertRule,
    AlertSeverity,
    PerformanceMetric,
    MetricType
)


def create_monitoring_demo_workflow() -> WorkflowDefinition:
    """创建用于监控演示的工作流"""
    
    nodes = [
        WorkflowNode(
            id="input_node",
            type="input",
            name="输入节点",
            description="接收用户输入",
            function_signature=NodeFunctionSignature(
                name="input_data",
                description="输入数据",
                category="io",
                inputs=[],
                outputs=[
                    NodeOutputSchema(
                        name="data",
                        type=DataType.OBJECT,
                        description="输入数据",
                        required=True
                    )
                ]
            ),
            position={"x": 100, "y": 100}
        ),
        WorkflowNode(
            id="slow_node",
            type="llm",
            name="慢速LLM节点",
            description="模拟慢速执行的LLM节点",
            function_signature=NodeFunctionSignature(
                name="slow_llm",
                description="慢速LLM处理",
                category="llm",
                inputs=[
                    NodeInputSchema(
                        name="prompt",
                        type=DataType.STRING,
                        description="提示",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="content",
                        type=DataType.STRING,
                        description="生成内容",
                        required=True
                    )
                ]
            ),
            config={
                "model": "qwen-turbo",
                "temperature": 0.7,
                "simulate_slow": True,
                "min_delay": 2.0,
                "max_delay": 5.0
            },
            position={"x": 400, "y": 100}
        ),
        WorkflowNode(
            id="error_prone_node",
            type="classifier",
            name="易错分类节点",
            description="模拟容易出错的分类节点",
            function_signature=NodeFunctionSignature(
                name="error_prone_classifier",
                description="容易出错的分类器",
                category="ai",
                inputs=[
                    NodeInputSchema(
                        name="text",
                        type=DataType.STRING,
                        description="待分类文本",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="class",
                        type=DataType.STRING,
                        description="分类结果",
                        required=True
                    )
                ]
            ),
            config={
                "classes": ["正面", "负面", "中性"],
                "error_rate": 0.3,  # 30%的错误率
                "simulate_errors": True
            },
            position={"x": 700, "y": 100}
        ),
        WorkflowNode(
            id="output_node",
            type="output",
            name="输出节点",
            description="输出最终结果",
            function_signature=NodeFunctionSignature(
                name="output_data",
                description="输出数据",
                category="io",
                inputs=[
                    NodeInputSchema(
                        name="data",
                        type=DataType.OBJECT,
                        description="输出数据",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="result",
                        type=DataType.OBJECT,
                        description="最终结果",
                        required=True
                    )
                ]
            ),
            position={"x": 1000, "y": 100}
        )
    ]
    
    edges = [
        WorkflowEdge(
            id="edge_1",
            source="input_node",
            target="slow_node",
            source_output="data",
            target_input="prompt",
            transform="value.get('text', 'default prompt')"
        ),
        WorkflowEdge(
            id="edge_2",
            source="slow_node",
            target="error_prone_node",
            source_output="content",
            target_input="text"
        ),
        WorkflowEdge(
            id="edge_3",
            source="error_prone_node",
            target="output_node",
            source_output="class",
            target_input="data"
        )
    ]
    
    return WorkflowDefinition(
        id="monitoring_demo_workflow",
        name="性能监控演示工作流",
        description="用于演示性能监控功能的工作流",
        version="1.0.0",
        nodes=nodes,
        edges=edges,
        global_config={
            "timeout": 30,
            "enable_monitoring": True,
            "enable_alerts": True
        }
    )


async def setup_performance_monitoring():
    """设置性能监控"""
    
    print("🔧 配置性能监控系统")
    print("=" * 50)
    
    # 启动性能监控
    await workflow_execution_engine.start_performance_monitoring()
    
    # 添加自定义告警规则
    custom_rules = [
        AlertRule(
            name="workflow_execution_very_slow",
            metric_name="workflow_execution_duration",
            threshold=10.0,  # 10秒
            comparison=">",
            severity=AlertSeverity.ERROR,
            message_template="工作流执行时间过长: {current_value:.2f}秒 (阈值: {threshold}秒)",
            labels={"workflow_id": "monitoring_demo_workflow"}
        ),
        AlertRule(
            name="node_error_rate_critical",
            metric_name="node_error_rate",
            threshold=0.5,  # 50%
            comparison=">",
            severity=AlertSeverity.CRITICAL,
            message_template="节点错误率达到临界值: {current_value:.2%} (阈值: {threshold:.2%})",
            labels={"node_id": "error_prone_node"}
        ),
        AlertRule(
            name="node_execution_slow",
            metric_name="node_execution_duration",
            threshold=3.0,  # 3秒
            comparison=">",
            severity=AlertSeverity.WARNING,
            message_template="节点执行缓慢: {current_value:.2f}秒 (阈值: {threshold}秒)"
        )
    ]\n    \n    # 添加告警规则\n    for rule in custom_rules:\n        workflow_performance_monitor.add_alert_rule(rule)\n        print(f\"✅ 添加告警规则: {rule.name}\")\n    \n    print(f\"📊 性能监控系统已启动\")\n    print(f\"🚨 告警规则已配置: {len(custom_rules)}个\")\n\n\nasync def run_monitoring_demo():\n    \"\"\"运行监控演示\"\"\"\n    \n    print(\"\\n🚀 开始性能监控演示\")\n    print(\"=\" * 50)\n    \n    # 创建工作流\n    workflow_def = create_monitoring_demo_workflow()\n    \n    # 模拟多次执行以产生性能数据\n    execution_results = []\n    \n    for i in range(10):\n        print(f\"\\n🔄 执行第 {i+1} 次工作流...\")\n        \n        # 准备输入数据\n        input_data = {\n            \"text\": f\"这是第{i+1}次测试，内容会影响执行结果\",\n            \"execution_round\": i + 1,\n            \"timestamp\": datetime.now().isoformat()\n        }\n        \n        try:\n            # 执行工作流\n            start_time = time.time()\n            context = await workflow_execution_engine.execute_workflow(\n                workflow_definition=workflow_def,\n                input_data=input_data,\n                debug=False\n            )\n            \n            execution_time = time.time() - start_time\n            execution_results.append({\n                \"round\": i + 1,\n                \"status\": context.status,\n                \"duration\": execution_time,\n                \"steps\": len(context.steps),\n                \"errors\": len([s for s in context.steps if s.status == \"error\"])\n            })\n            \n            print(f\"   ✅ 状态: {context.status}, 耗时: {execution_time:.2f}秒\")\n            \n        except Exception as e:\n            print(f\"   ❌ 执行失败: {str(e)}\")\n            execution_results.append({\n                \"round\": i + 1,\n                \"status\": \"error\",\n                \"duration\": 0,\n                \"steps\": 0,\n                \"errors\": 1\n            })\n        \n        # 短暂延迟\n        await asyncio.sleep(1)\n    \n    return execution_results\n\n\nasync def analyze_performance_data():\n    \"\"\"分析性能数据\"\"\"\n    \n    print(\"\\n📊 性能数据分析\")\n    print(\"=\" * 50)\n    \n    # 获取性能仪表板\n    dashboard = workflow_execution_engine.get_performance_dashboard()\n    \n    if not dashboard.get(\"performance_monitoring_enabled\", True):\n        print(\"⚠️  性能监控未启用\")\n        return\n    \n    # 显示总体统计\n    stats = dashboard.get(\"statistics\", {})\n    \n    print(\"📈 工作流统计:\")\n    workflow_stats = stats.get(\"workflow_statistics\", {})\n    if workflow_stats:\n        print(f\"   总执行次数: {workflow_stats.get('total_executions', 0)}\")\n        print(f\"   成功执行次数: {workflow_stats.get('completed_executions', 0)}\")\n        print(f\"   失败执行次数: {workflow_stats.get('failed_executions', 0)}\")\n        print(f\"   平均执行时间: {workflow_stats.get('average_execution_time', 0):.2f}秒\")\n        print(f\"   处理节点总数: {workflow_stats.get('total_nodes_processed', 0)}\")\n    \n    print(\"\\n🔧 节点统计:\")\n    node_stats = stats.get(\"node_statistics\", {})\n    if node_stats:\n        print(f\"   节点总数: {node_stats.get('total_nodes', 0)}\")\n        print(f\"   节点执行总次数: {node_stats.get('total_executions', 0)}\")\n        print(f\"   平均节点执行时间: {node_stats.get('average_execution_time', 0):.2f}秒\")\n        \n        # 显示最慢的节点\n        slowest_nodes = node_stats.get('slowest_nodes', [])\n        if slowest_nodes:\n            print(f\"   最慢的节点:\")\n            for node in slowest_nodes[:3]:\n                print(f\"     • {node['node_name']}: {node['average_duration']:.2f}秒\")\n        \n        # 显示最容易出错的节点\n        error_prone_nodes = node_stats.get('most_error_prone_nodes', [])\n        if error_prone_nodes:\n            print(f\"   最容易出错的节点:\")\n            for node in error_prone_nodes[:3]:\n                print(f\"     • {node['node_name']}: {node['error_rate']:.2%}错误率\")\n    \n    print(\"\\n🖥️  系统统计:\")\n    system_stats = stats.get(\"system_statistics\", {})\n    if system_stats:\n        print(f\"   平均CPU使用率: {system_stats.get('average_cpu_usage', 0):.1f}%\")\n        print(f\"   平均内存使用率: {system_stats.get('average_memory_usage', 0):.1f}%\")\n        print(f\"   当前进程数: {system_stats.get('current_process_count', 0)}\")\n        print(f\"   当前线程数: {system_stats.get('current_thread_count', 0)}\")\n\n\nasync def demonstrate_alerts():\n    \"\"\"演示告警功能\"\"\"\n    \n    print(\"\\n🚨 告警系统演示\")\n    print(\"=\" * 50)\n    \n    # 获取告警摘要\n    alert_summary = workflow_execution_engine.get_alert_summary()\n    \n    if not alert_summary.get(\"performance_monitoring_enabled\", True):\n        print(\"⚠️  性能监控未启用\")\n        return\n    \n    # 显示活跃告警\n    active_alerts = alert_summary.get(\"active_alerts\", {})\n    total_alerts = active_alerts.get(\"total\", 0)\n    \n    print(f\"📊 告警统计:\")\n    print(f\"   总告警数: {total_alerts}\")\n    print(f\"   严重告警: {active_alerts.get('critical', 0)}\")\n    print(f\"   错误告警: {active_alerts.get('error', 0)}\")\n    print(f\"   警告告警: {active_alerts.get('warning', 0)}\")\n    print(f\"   信息告警: {active_alerts.get('info', 0)}\")\n    \n    # 显示最近的告警\n    recent_alerts = alert_summary.get(\"recent_alerts\", [])\n    if recent_alerts:\n        print(f\"\\n🔔 最近的告警:\")\n        for alert in recent_alerts[-5:]:\n            severity_icon = {\n                \"critical\": \"🔴\",\n                \"error\": \"🟠\",\n                \"warning\": \"🟡\",\n                \"info\": \"🔵\"\n            }.get(alert.get(\"severity\", \"info\"), \"🔵\")\n            \n            print(f\"   {severity_icon} {alert.get('message', 'Unknown alert')}\")\n    \n    # 显示告警规则\n    alert_rules = alert_summary.get(\"alert_rules\", [])\n    if alert_rules:\n        print(f\"\\n📋 告警规则 ({len(alert_rules)}个):\")\n        for rule in alert_rules:\n            print(f\"   • {rule['name']}: {rule['metric_name']} {rule['comparison']} {rule['threshold']}\")\n\n\nasync def demonstrate_detailed_reports():\n    \"\"\"演示详细报告功能\"\"\"\n    \n    print(\"\\n📋 详细报告演示\")\n    print(\"=\" * 50)\n    \n    # 获取工作流性能报告\n    workflow_report = workflow_execution_engine.get_workflow_performance_report(\n        \"monitoring_demo_workflow\"\n    )\n    \n    if \"error\" not in workflow_report:\n        print(\"📊 工作流性能报告:\")\n        summary = workflow_report.get(\"summary\", {})\n        performance = workflow_report.get(\"performance\", {})\n        \n        print(f\"   总执行次数: {summary.get('total_executions', 0)}\")\n        print(f\"   成功率: {summary.get('success_rate', 0):.2%}\")\n        print(f\"   平均执行时间: {performance.get('average_duration', 0):.2f}秒\")\n        print(f\"   最快执行时间: {performance.get('min_duration', 0):.2f}秒\")\n        print(f\"   最慢执行时间: {performance.get('max_duration', 0):.2f}秒\")\n    \n    # 获取节点性能报告\n    node_report = workflow_execution_engine.get_node_performance_report(\"slow_node\")\n    \n    if \"error\" not in node_report:\n        print(f\"\\n🔧 节点性能报告 (slow_node):\")\n        basic_info = node_report.get(\"basic_info\", {})\n        performance = node_report.get(\"performance\", {})\n        reliability = node_report.get(\"reliability\", {})\n        trend = node_report.get(\"trend_analysis\", {})\n        \n        print(f\"   节点名称: {basic_info.get('node_name', 'Unknown')}\")\n        print(f\"   执行次数: {basic_info.get('execution_count', 0)}\")\n        print(f\"   平均执行时间: {performance.get('average_duration', 0):.2f}秒\")\n        print(f\"   成功率: {reliability.get('success_rate', 0):.2%}\")\n        print(f\"   错误率: {reliability.get('error_rate', 0):.2%}\")\n        \n        if trend:\n            print(f\"   性能趋势: {trend.get('trend_direction', 'unknown')}\")\n            print(f\"   趋势幅度: {trend.get('trend_percentage', 0):.1f}%\")\n\n\nasync def demonstrate_system_health():\n    \"\"\"演示系统健康状态\"\"\"\n    \n    print(\"\\n🏥 系统健康状态\")\n    print(\"=\" * 50)\n    \n    # 模拟系统健康检查API调用\n    dashboard = workflow_execution_engine.get_performance_dashboard()\n    \n    # 提取系统健康指标\n    system_stats = dashboard.get(\"statistics\", {}).get(\"system_statistics\", {})\n    alerts = dashboard.get(\"active_alerts\", {})\n    \n    # 计算健康评分\n    health_score = 100\n    \n    # CPU使用率影响\n    cpu_usage = system_stats.get(\"average_cpu_usage\", 0)\n    if cpu_usage > 80:\n        health_score -= 20\n    elif cpu_usage > 60:\n        health_score -= 10\n    \n    # 内存使用率影响\n    memory_usage = system_stats.get(\"average_memory_usage\", 0)\n    if memory_usage > 85:\n        health_score -= 20\n    elif memory_usage > 70:\n        health_score -= 10\n    \n    # 告警影响\n    critical_alerts = alerts.get(\"critical\", 0)\n    error_alerts = alerts.get(\"error\", 0)\n    warning_alerts = alerts.get(\"warning\", 0)\n    \n    health_score -= critical_alerts * 15\n    health_score -= error_alerts * 10\n    health_score -= warning_alerts * 5\n    \n    health_score = max(0, health_score)\n    \n    # 确定健康状态\n    if health_score >= 80:\n        status = \"healthy\"\n        status_icon = \"✅\"\n    elif health_score >= 60:\n        status = \"warning\"\n        status_icon = \"⚠️\"\n    elif health_score >= 40:\n        status = \"degraded\"\n        status_icon = \"🔶\"\n    else:\n        status = \"critical\"\n        status_icon = \"🔴\"\n    \n    print(f\"📊 系统健康状态: {status_icon} {status} ({health_score}分)\")\n    print(f\"💻 CPU使用率: {cpu_usage:.1f}%\")\n    print(f\"💾 内存使用率: {memory_usage:.1f}%\")\n    print(f\"🚨 活跃告警: {critical_alerts + error_alerts + warning_alerts}个\")\n    \n    # 生成健康建议\n    recommendations = []\n    if cpu_usage > 80:\n        recommendations.append(\"系统CPU使用率过高，建议优化或扩容资源\")\n    if memory_usage > 85:\n        recommendations.append(\"系统内存使用率过高，建议清理缓存或增加内存\")\n    if critical_alerts > 0:\n        recommendations.append(\"存在严重告警，请立即检查和解决\")\n    if error_alerts > 0:\n        recommendations.append(\"存在错误告警，请及时处理\")\n    \n    if not recommendations:\n        recommendations.append(\"系统运行正常，请继续保持监控\")\n    \n    print(f\"\\n💡 健康建议:\")\n    for rec in recommendations:\n        print(f\"   • {rec}\")\n\n\nasync def cleanup_and_summary():\n    \"\"\"清理和总结\"\"\"\n    \n    print(\"\\n🧹 清理演示数据\")\n    print(\"=\" * 50)\n    \n    # 获取最终统计\n    final_stats = workflow_execution_engine.get_execution_metrics()\n    \n    print(\"📊 最终统计:\")\n    if \"performance_monitoring\" in final_stats:\n        monitoring_stats = final_stats[\"performance_monitoring\"]\n        print(f\"   监控状态: {'启用' if monitoring_stats.get('system_status', {}).get('monitoring_enabled') else '禁用'}\")\n        print(f\"   收集指标数: {monitoring_stats.get('system_status', {}).get('metrics_count', 0)}\")\n        print(f\"   监控工作流数: {monitoring_stats.get('system_status', {}).get('workflow_count', 0)}\")\n        print(f\"   监控节点数: {monitoring_stats.get('system_status', {}).get('node_count', 0)}\")\n    \n    # 停止性能监控\n    await workflow_execution_engine.stop_performance_monitoring()\n    \n    # 清理性能历史数据\n    workflow_execution_engine.clear_performance_history()\n    \n    print(\"✅ 性能监控已停止\")\n    print(\"✅ 历史数据已清理\")\n\n\nasync def main():\n    \"\"\"主演示函数\"\"\"\n    \n    print(\"🎯 工作流性能监控完整演示\")\n    print(\"=\" * 60)\n    \n    try:\n        # 1. 设置性能监控\n        await setup_performance_monitoring()\n        \n        # 2. 运行监控演示\n        execution_results = await run_monitoring_demo()\n        \n        # 3. 分析性能数据\n        await analyze_performance_data()\n        \n        # 4. 演示告警功能\n        await demonstrate_alerts()\n        \n        # 5. 演示详细报告\n        await demonstrate_detailed_reports()\n        \n        # 6. 演示系统健康状态\n        await demonstrate_system_health()\n        \n        # 7. 清理和总结\n        await cleanup_and_summary()\n        \n        print(\"\\n🎉 性能监控演示完成!\")\n        print(\"=\" * 60)\n        \n        # 显示执行摘要\n        successful_executions = len([r for r in execution_results if r[\"status\"] == \"completed\"])\n        total_executions = len(execution_results)\n        \n        print(f\"📊 执行摘要:\")\n        print(f\"   总执行次数: {total_executions}\")\n        print(f\"   成功次数: {successful_executions}\")\n        print(f\"   成功率: {successful_executions/total_executions:.2%}\")\n        \n        if execution_results:\n            avg_duration = sum(r[\"duration\"] for r in execution_results) / len(execution_results)\n            print(f\"   平均执行时间: {avg_duration:.2f}秒\")\n        \n    except Exception as e:\n        print(f\"❌ 演示过程中发生错误: {str(e)}\")\n        import traceback\n        traceback.print_exc()\n    \n    finally:\n        # 确保清理资源\n        try:\n            await workflow_execution_engine.stop_performance_monitoring()\n        except:\n            pass\n\n\nif __name__ == \"__main__\":\n    asyncio.run(main())"