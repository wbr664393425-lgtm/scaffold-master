# 后端镜像：Maven 单遍构建 → JRE 运行
# 构建上下文为 scaffold-system 目录
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY . .
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
# curl 供容器健康检查使用
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/scaffold-admin/target/scaffold-admin-*.jar app.jar
EXPOSE 8080
ENV TZ=Asia/Shanghai \
    JAVA_OPTS=""
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
