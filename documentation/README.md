# 📚 Wallet Analysis System - Documentation Hub

## 🎯 Welcome to the Documentation

This is your **one-stop resource** for understanding, using, and contributing to the Wallet Analysis System. The documentation is organized to reflect the actual codebase structure and provides both high-level overviews and deep technical details.

## 📋 **Documentation Status: 90% Complete**

We've successfully documented the **core system architecture**, **major components**, and **job queue system**. The remaining work focuses on **operational aspects** like performance tuning and deployment.

## 🗂️ **Documentation Structure**

### **📖 Foundation Documentation**
- **[00. PROJECT_OVERVIEW.md](./00.%20PROJECT_OVERVIEW.md)** - **✅ COMPLETE** High-level system overview
- **[01. ARCHITECTURE_DECISIONS.md](./01.%20ARCHITECTURE_DECISIONS.md)** - **✅ COMPLETE** Technical decisions and trade-offs
- **[02. QUICK_START.md](./02.%20QUICK_START.md)** - **✅ COMPLETE** Setup and basic usage guide

### **🔧 Technical Documentation (Deep Dive)**
- **[technical/core/](./technical/core/)** - **✅ COMPLETE** Core analysis engine documentation
- **[technical/api/](./technical/api/)** - **✅ COMPLETE** Backend API layer documentation
- **[technical/frontend/](./technical/frontend/)** - **✅ COMPLETE** Frontend dashboard documentation
- **[technical/database/](./technical/database/)** - **✅ COMPLETE** Database schema documentation
- **[technical/queues/](./technical/queues/)** - **✅ COMPLETE** Job queue system documentation

### **🚀 Operational Documentation**
- **[technical/performance/](./technical/performance/)** - **⏳ PENDING** Performance tuning and optimization
- **[technical/deployment/](./technical/deployment/)** - Historical architecture notes; current production runbook is [`deployment/README.md`](../deployment/README.md)

### **📚 Guides & References**
- **[guides/troubleshooting.md](./guides/troubleshooting.md)** - **✅ COMPLETE** Common issues and solutions

## 🎉 **What Each Section Covers**

### **Foundation Documents**
- **Project Overview**: What the system does, its purpose, and current capabilities
- **Architecture Decisions**: Why certain technical choices were made and their trade-offs
- **Quick Start**: How to get up and running quickly with the system

### **Technical Deep-Dives**
- **Core Analysis Engine**: Business logic for wallet analysis, similarity, and correlation
- **Backend API**: RESTful endpoints, controllers, services, and integrations
- **Frontend Dashboard**: Next.js 14 application with real-time updates and visualization
- **Database Schema**: SQLite models, relationships, and optimization strategies
- **Job Queue System**: BullMQ implementation, distributed locking, and background processing

### **Operational Guides**
- **Performance Tuning**: Optimization strategies, benchmarking, and monitoring
- **Deployment Guide**: Current setup and operations live in [`deployment/README.md`](../deployment/README.md)

## 🚀 **Getting Started**

1. **New to the project?** Start with [Project Overview](./00.%20PROJECT_OVERVIEW.md)
2. **Setting up development?** Follow the [Quick Start Guide](./02.%20QUICK_START.md)
3. **Understanding architecture?** Read [Architecture Decisions](./01.%20ARCHITECTURE_DECISIONS.md)
4. **Deep technical details?** Dive into the [Technical Documentation](./technical/)
5. **Running into issues?** Check the [Troubleshooting Guide](./guides/troubleshooting.md)

## 🔍 **Recent Updates**

- **✅ COMPLETED**: Job Queue System deep-dive documentation
- **✅ COMPLETED**: Core Analysis Engine detailed analysis
- **✅ COMPLETED**: Backend API layer comprehensive coverage
- **✅ COMPLETED**: Frontend Dashboard architecture documentation
- **✅ COMPLETED**: Database Schema detailed breakdown

## 📝 **Contributing to Documentation**

When updating documentation:
1. **Keep it current**: Ensure documentation reflects the actual codebase
2. **Be thorough**: Include code examples and real implementations
3. **Stay organized**: Follow the established structure and naming conventions
4. **Update status**: Mark completed sections in this hub

## 🔗 **Quick Links**

- **System Overview**: [00. PROJECT_OVERVIEW.md](./00.%20PROJECT_OVERVIEW.md)
- **Core Engine**: [technical/core/](./technical/core/)
- **API Layer**: [technical/api/](./technical/api/)
- **Frontend**: [technical/frontend/](./technical/frontend/)
- **Database**: [technical/database/](./technical/database/)
- **Job Queues**: [technical/queues/](./technical/queues/)
- **Troubleshooting**: [guides/troubleshooting.md](./guides/troubleshooting.md)

## ⚠️ **Critical Resources**

**READ THESE BEFORE DEVELOPING:**

- **[Cache Management Guide](./technical/frontend/CACHE_MANAGEMENT.md)** - ⚠️ **MUST READ** - Complete guide to SWR cache behavior, limitations, and solutions
- **[Cache Quick Reference](./CACHE_QUICK_REFERENCE.md)** - 📋 One-page reference card for cache troubleshooting

**Why these are critical:** We've spent hours debugging cache issues multiple times. These documents prevent recurring problems with:
- Data not refreshing after analysis
- Images not appearing after enrichment
- Stale data showing on scope changes
- Unnecessary manual refresh requirements

---

*Last updated: Cache Management documentation added (October 31, 2025)*
