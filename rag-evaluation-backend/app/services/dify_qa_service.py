import random
from typing import Any, Dict, List, Optional

import httpx


class DifyClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def list_all_knowledge_bases(self) -> List[Dict[str, Any]]:
        """分页获取该 API Key 下所有可见知识库"""
        kbs: List[Dict[str, Any]] = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                resp = await client.get(
                    f"{self.base_url}/datasets",
                    headers=self.headers,
                    params={"page": page, "limit": 100},
                )
                resp.raise_for_status()
                data = resp.json()
                kbs.extend(data.get("data", []))
                if not data.get("has_more", False):
                    break
                page += 1
        return kbs

    async def list_all_documents(self, knowledge_id: str) -> List[Dict[str, Any]]:
        """分页获取知识库中所有可用文档"""
        documents: List[Dict[str, Any]] = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                resp = await client.get(
                    f"{self.base_url}/datasets/{knowledge_id}/documents",
                    headers=self.headers,
                    params={"page": page, "limit": 100},
                )
                resp.raise_for_status()
                data = resp.json()
                for doc in data.get("data", []):
                    if doc.get("enabled", True) and not doc.get("archived", False):
                        documents.append(doc)
                if not data.get("has_more", False):
                    break
                page += 1
        return documents

    async def list_document_segments(
        self, knowledge_id: str, document_id: str
    ) -> List[Dict[str, Any]]:
        """分页获取文档的所有已完成分段"""
        segments: List[Dict[str, Any]] = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                resp = await client.get(
                    f"{self.base_url}/datasets/{knowledge_id}/documents/{document_id}/segments",
                    headers=self.headers,
                    params={"page": page, "limit": 100, "status": "completed"},
                )
                resp.raise_for_status()
                data = resp.json()
                for seg in data.get("data", []):
                    if seg.get("enabled", True) and seg.get("content"):
                        segments.append(seg)
                if not data.get("has_more", False):
                    break
                page += 1
        return segments

    @staticmethod
    def select_chunk(segments: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """chunk 数 > 2 取中间那个，否则随机取一个"""
        if not segments:
            return None
        if len(segments) > 2:
            return segments[len(segments) // 2]
        return random.choice(segments)

    async def _resolve_knowledge_ids(self, knowledge_id: Optional[str]) -> List[str]:
        """knowledge_id 为 None 时返回该 API Key 下所有知识库 ID"""
        if knowledge_id:
            return [knowledge_id]
        kbs = await self.list_all_knowledge_bases()
        return [kb["id"] for kb in kbs]

    async def prepare_single_doc_groups(
        self, knowledge_id: Optional[str]
    ) -> tuple[List[List[Dict[str, Any]]], int]:
        """
        单文档模式：每个文档选一个 chunk，返回 [[chunk_info], ...] 和文档总数。
        knowledge_id 为 None 时遍历所有知识库。
        """
        knowledge_ids = await self._resolve_knowledge_ids(knowledge_id)
        groups: List[List[Dict[str, Any]]] = []
        total_docs = 0

        for kid in knowledge_ids:
            documents = await self.list_all_documents(kid)
            total_docs += len(documents)
            for doc in documents:
                segments = await self.list_document_segments(kid, doc["id"])
                chunk = self.select_chunk(segments)
                if chunk:
                    groups.append(
                        [
                            {
                                "doc_id": doc["id"],
                                "doc_name": doc.get("name", ""),
                                "chunk_content": chunk.get("content", ""),
                                "chunk_id": chunk.get("id", ""),
                            }
                        ]
                    )

        return groups, total_docs

    async def prepare_cross_doc_groups(
        self, knowledge_id: Optional[str], count: int
    ) -> tuple[List[List[Dict[str, Any]]], int]:
        """
        跨文档模式：生成 count 组，每组随机取不超过 5 个文档各自的一个 chunk。
        knowledge_id 为 None 时跨所有知识库随机组合。
        """
        knowledge_ids = await self._resolve_knowledge_ids(knowledge_id)

        # 收集所有知识库的文档和其 segments
        all_docs: List[Dict[str, Any]] = []
        doc_segments: Dict[str, List[Dict[str, Any]]] = {}

        for kid in knowledge_ids:
            documents = await self.list_all_documents(kid)
            for doc in documents:
                segs = await self.list_document_segments(kid, doc["id"])
                if segs:
                    doc["_knowledge_id"] = kid  # 记录所属知识库，供后续使用
                    all_docs.append(doc)
                    doc_segments[doc["id"]] = segs

        total_docs = len(all_docs)
        if not all_docs:
            return [], 0

        groups: List[List[Dict[str, Any]]] = []
        for _ in range(count):
            n = min(5, len(all_docs))
            if n < 2:
                break
            selected = random.sample(all_docs, n)
            group = []
            for doc in selected:
                chunk = self.select_chunk(doc_segments[doc["id"]])
                if chunk:
                    group.append(
                        {
                            "doc_id": doc["id"],
                            "doc_name": doc.get("name", ""),
                            "chunk_content": chunk.get("content", ""),
                            "chunk_id": chunk.get("id", ""),
                        }
                    )
            if len(group) >= 2:
                groups.append(group)

        return groups, total_docs
