"""
工作流数据流模式定义
"""

from typing import Dict, List, Any, Optional, Union
from pydantic import BaseModel, Field
from enum import Enum


class DataType(str, Enum):
    """数据类型枚举"""
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    ARRAY = "array"
    OBJECT = "object"
    FILE = "file"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"


class NodeInputSchema(BaseModel):
    """节点输入模式"""
    name: str = Field(..., description="输入参数名称")
    type: DataType = Field(..., description="数据类型")
    description: str = Field(..., description="参数描述")
    required: bool = Field(True, description="是否必需")
    default: Optional[Any] = Field(None, description="默认值")
    validation: Optional[Dict[str, Any]] = Field(None, description="验证规则")
    example: Optional[Any] = Field(None, description="示例值")


class NodeOutputSchema(BaseModel):
    """节点输出模式"""
    name: str = Field(..., description="输出参数名称")
    type: DataType = Field(..., description="数据类型")
    description: str = Field(..., description="参数描述")
    required: bool = Field(True, description="是否必需")
    example: Optional[Any] = Field(None, description="示例值")


class NodeFunctionSignature(BaseModel):
    """节点函数签名"""
    name: str = Field(..., description="函数名称")
    description: str = Field(..., description="函数描述")
    category: str = Field(..., description="分类")
    inputs: List[NodeInputSchema] = Field(..., description="输入参数")
    outputs: List[NodeOutputSchema] = Field(..., description="输出参数")
    code: Optional[str] = Field(None, description="函数代码")
    async_execution: bool = Field(True, description="是否异步执行")
    timeout: int = Field(300, description="超时时间（秒）")
    memory_limit: int = Field(512, description="内存限制（MB）")


class WorkflowNode(BaseModel):
    """工作流节点"""
    id: str = Field(..., description="节点ID")
    type: str = Field(..., description="节点类型")
    name: str = Field(..., description="节点名称")
    description: Optional[str] = Field(None, description="节点描述")
    function_signature: NodeFunctionSignature = Field(..., description="函数签名")
    config: Dict[str, Any] = Field(default_factory=dict, description="节点配置")
    position: Dict[str, float] = Field(default_factory=dict, description="节点位置")
    enabled: bool = Field(True, description="是否启用")


class WorkflowEdge(BaseModel):
    """工作流边"""
    id: str = Field(..., description="边ID")
    source: str = Field(..., description="源节点ID")
    target: str = Field(..., description="目标节点ID")
    source_output: str = Field(..., description="源节点输出字段")
    target_input: str = Field(..., description="目标节点输入字段")
    condition: Optional[str] = Field(None, description="条件表达式")
    transform: Optional[str] = Field(None, description="数据转换函数")


class WorkflowDefinition(BaseModel):
    """工作流定义"""
    id: str = Field(..., description="工作流ID")
    name: str = Field(..., description="工作流名称")
    description: Optional[str] = Field(None, description="工作流描述")
    version: str = Field("1.0.0", description="版本号")
    nodes: List[WorkflowNode] = Field(..., description="节点列表")
    edges: List[WorkflowEdge] = Field(..., description="边列表")
    global_config: Dict[str, Any] = Field(default_factory=dict, description="全局配置")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class ExecutionStep(BaseModel):
    """执行步骤"""
    step_id: str = Field(..., description="步骤ID")
    node_id: str = Field(..., description="节点ID")
    node_name: str = Field(..., description="节点名称")
    status: str = Field("pending", description="状态")
    start_time: Optional[float] = Field(None, description="开始时间")
    end_time: Optional[float] = Field(None, description="结束时间")
    duration: Optional[float] = Field(None, description="执行时长")
    input_data: Dict[str, Any] = Field(default_factory=dict, description="输入数据")
    output_data: Dict[str, Any] = Field(default_factory=dict, description="输出数据")
    error: Optional[str] = Field(None, description="错误信息")
    memory_usage: Optional[float] = Field(None, description="内存使用量")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="性能指标")


class WorkflowExecutionContext(BaseModel):
    """工作流执行上下文"""
    execution_id: str = Field(..., description="执行ID")
    workflow_id: str = Field(..., description="工作流ID")
    status: str = Field("running", description="执行状态")
    start_time: float = Field(..., description="开始时间")
    end_time: Optional[float] = Field(None, description="结束时间")
    input_data: Dict[str, Any] = Field(..., description="输入数据")
    output_data: Dict[str, Any] = Field(default_factory=dict, description="输出数据")
    global_context: Dict[str, Any] = Field(default_factory=dict, description="全局上下文")
    steps: List[ExecutionStep] = Field(default_factory=list, description="执行步骤")
    checkpoints: List[Dict[str, Any]] = Field(default_factory=list, description="检查点")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="执行指标")
    error: Optional[str] = Field(None, description="错误信息")


class DataFlowValidation(BaseModel):
    """数据流验证"""
    is_valid: bool = Field(..., description="是否有效")
    errors: List[str] = Field(default_factory=list, description="错误列表")
    warnings: List[str] = Field(default_factory=list, description="警告列表")
    suggestions: List[str] = Field(default_factory=list, description="建议列表")


class WorkflowTemplate(BaseModel):
    """工作流模板"""
    id: str = Field(..., description="模板ID")
    name: str = Field(..., description="模板名称")
    description: str = Field(..., description="模板描述")
    category: str = Field(..., description="分类")
    tags: List[str] = Field(default_factory=list, description="标签")
    workflow_definition: WorkflowDefinition = Field(..., description="工作流定义")
    parameters: List[NodeInputSchema] = Field(default_factory=list, description="模板参数")
    example_inputs: Dict[str, Any] = Field(default_factory=dict, description="示例输入")
    example_outputs: Dict[str, Any] = Field(default_factory=dict, description="示例输出")