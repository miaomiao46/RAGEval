"""Add dataset_type field to datasets table

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-26

dataset_type values:
  standard - 普通检索数据集 (直接事实检索, easy/medium, 事实型/概念型)
  advanced - 高级检索数据集 (推理/归纳/多跳检索, medium/hard, 推理型/归纳型/比较型)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "dataset_type",
            sa.String(20),
            nullable=False,
            server_default="standard",
            comment="数据集类型: standard=普通检索, advanced=高级检索(含推理/归纳)"
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "dataset_type")
