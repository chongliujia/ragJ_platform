# 目录结构设计

我们将采用一个清晰的、模块化的目录结构，以便于团队协作、代码管理和未来的扩展。主要分为 `frontend`、`backend` (Python) 和 `rust_services` 三个顶级目录，以及 `docs` 和 `deploy` 等辅助目录。

```
rag_platform/
├── .git/
├── .github/              # GitHub Actions / CI/CD 配置
├── docs/                 # 项目文档，包括设计文档、API 文档、AI 辅助编程指南等
│   ├── architecture/
│   │   └── system_architecture_design.md
│   ├── development/
│   │   └── ai_programming_guide.md
│   └── README.md
├── frontend/             # 前端应用代码 (e.g., React/Vue)
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.js
│   ├── package.json
│   └── README.md
├── backend/              # Python 后端服务代码 (e.g., FastAPI)
│   ├── app/
│   │   ├── api/          # RESTful API 接口定义
│   │   ├── core/         # 核心业务逻辑、配置、依赖注入
│   │   ├── crud/         # 数据库操作 (Create, Read, Update, Delete)
│   │   ├── db/           # 数据库模型、迁移
│   │   ├── schemas/      # Pydantic 数据模型
│   │   ├── services/     # 业务服务层
│   │   ├── tasks/        # Celery 异步任务定义
│   │   └── main.py       # FastAPI 应用入口
│   ├── tests/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── README.md
├── rust_services/         # Rust 核心服务代码
│   ├── document_processor/ # 文档处理服务
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   └── main.rs
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   ├── vector_store_service/ # 向量存储服务
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   └── main.rs
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   ├── common/           # Rust 公共库，例如 gRPC 定义、数据结构
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   └── README.md
├── deploy/               # 部署相关配置 (e.g., Docker Compose, Kubernetes)
│   ├── docker-compose.yml
│   ├── kubernetes/
│   └── README.md
├── .env.example          # 环境变量示例
├── README.md             # 项目总览 README
└── todo.md               # 任务清单
```

## 模块划分说明

### `docs/`

*   `architecture/`: 存放系统架构设计文档。
*   `development/`: 存放开发指南，特别是 AI 辅助编程指南。

### `frontend/`

*   标准的 Web 前端项目结构，`src` 目录下按功能划分组件、页面、服务等。

### `backend/` (Python)

*   `app/`: 存放 FastAPI 应用的核心代码。
    *   `api/`: 定义所有 RESTful API 路由和处理函数。
    *   `core/`: 存放应用配置、日志、异常处理、依赖注入等核心通用模块。
    *   `crud/`: 封装数据库的增删改查操作，与 `db/` 中的模型对应。
    *   `db/`: 定义 SQLAlchemy 模型、数据库连接和 Alembic 迁移脚本。
    *   `schemas/`: 定义 Pydantic 模型，用于请求验证和响应序列化。
    *   `services/`: 存放业务逻辑服务，协调 `crud` 和外部服务（如 Rust 服务、LLM 服务）的调用。
    *   `tasks/`: 定义 Celery 异步任务，例如触发文档处理任务。
    *   `main.py`: FastAPI 应用的入口文件。

### `rust_services/`

*   `document_processor/`: 负责文档的解析、分块、清洗和嵌入生成。
    *   `src/`: 存放 Rust 源代码，`lib.rs` 可能包含核心逻辑库，`main.rs` 包含 gRPC 服务器或消息队列消费者入口。
*   `vector_store_service/`: 负责与向量数据库的交互，提供向量存储和检索接口。
    *   `src/`: 存放 Rust 源代码，`lib.rs` 可能包含核心逻辑库，`main.rs` 包含 gRPC 服务器入口。
*   `common/`: 存放 Rust 服务之间共享的代码，例如 gRPC 的 `.proto` 文件编译生成的 Rust 结构体、通用的数据结构和工具函数。

### `deploy/`

*   存放 Docker Compose 文件、Kubernetes YAML 文件等，用于定义和部署整个系统的服务。

