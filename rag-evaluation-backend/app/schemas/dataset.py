from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID

# 数据集类型枚举
# standard: 普通检索数据集 - 以直接事实检索为主(easy/medium，事实型/概念型)
# advanced: 高级检索数据集 - 含推理、归纳能力的问题(medium/hard，推理型/归纳型/比较型)
DATASET_TYPE_STANDARD = "standard"
DATASET_TYPE_ADVANCED = "advanced"

# 基础数据集模型
class DatasetBase(BaseModel):
    name: str
    description: Optional[str] = None
    is_public: Optional[bool] = False
    tags: Optional[List[str]] = Field(default_factory=list)
    dataset_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    dataset_type: Optional[str] = DATASET_TYPE_STANDARD  # standard | advanced

# 创建数据集时的请求模型
class DatasetCreate(DatasetBase):
    pass

# 更新数据集时的请求模型
class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    tags: Optional[List[str]] = None
    dataset_metadata: Optional[Dict[str, Any]] = None

# 数据集响应模型
class DatasetOut(DatasetBase):
    id: str
    user_id: Optional[str] = None
    question_count: int = 0
    dataset_type: str = DATASET_TYPE_STANDARD
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# 数据集详情响应模型
class DatasetDetail(DatasetOut):
    projects: List[Dict[str, str]] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

# 项目-数据集关联模型
class ProjectDatasetLink(BaseModel):
    project_id: str
    dataset_id: str

    model_config = ConfigDict(from_attributes=True)

# 批量关联数据集请求
class BatchLinkDatasets(BaseModel):
    dataset_ids: List[str] 
