// src/app/dashboard/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DASHBOARD_TARGET = "http://127.0.0.1:18789";

async function proxyRequest(request: NextRequest) {
  const url = new URL(request.url);
  // 目标 URL：保留 dashboard 之后的路径和查询参数
  const targetPath = url.pathname.replace(/^\/dashboard/, "") + url.search;
  const targetUrl = new URL(targetPath || "/", DASHBOARD_TARGET);

  // 复制请求体（如果有）
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.clone().arrayBuffer();

  const headers = new Headers(request.headers);
  // 删除可能导致问题的 header
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
    body: body ?? undefined,
    redirect: "manual",
    // @ts-ignore - Next.js 扩展了 fetch 支持 duplex
    duplex: "half",
  };

  try {
    const response = await fetch(targetUrl.toString(), fetchOptions);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("content-encoding");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[dashboard proxy] Error:", error);
    return new NextResponse("Dashboard proxy error", { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request);
}

export async function POST(request: NextRequest) {
  return proxyRequest(request);
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request);
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request);
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request);
}

export async function OPTIONS(request: NextRequest) {
  return proxyRequest(request);
}

export async function HEAD(request: NextRequest) {
  return proxyRequest(request);
}