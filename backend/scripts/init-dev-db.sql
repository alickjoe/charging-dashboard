-- 充电桩示例数据表
-- 此脚本在 Docker postgres-dev 容器首次启动时自动执行

CREATE TABLE IF NOT EXISTS charging_stations (
    station_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_name VARCHAR(200) NOT NULL,
    location VARCHAR(500),
    total_ports INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charging_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES charging_stations(station_id),
    port_number INTEGER NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    energy_kwh DECIMAL(10, 2),
    cost DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'completed',
    vehicle_plate VARCHAR(20),
    user_id VARCHAR(50)
);

-- 插入示例充电站
INSERT INTO charging_stations (station_id, station_name, location, total_ports) VALUES
    ('a0000000-0000-0000-0000-000000000001', '浦东充电站', '上海市浦东新区张江高科技园区', 20),
    ('a0000000-0000-0000-0000-000000000002', '徐汇充电站', '上海市徐汇区漕河泾开发区', 15),
    ('a0000000-0000-0000-0000-000000000003', '静安充电站', '上海市静安区南京西路', 10);

-- 插入示例充电记录 (近30天)
INSERT INTO charging_sessions (session_id, station_id, port_number, start_time, end_time, energy_kwh, cost, status, vehicle_plate, user_id)
SELECT
    gen_random_uuid(),
    station_id,
    (random() * total_ports)::INTEGER + 1,
    start_ts,
    start_ts + (random() * INTERVAL '4 hours'),
    round((random() * 60 + 5)::numeric, 2),
    round((random() * 80 + 10)::numeric, 2),
    CASE WHEN random() < 0.9 THEN 'completed' ELSE 'interrupted' END,
    '沪' || chr(65 + (random() * 26)::INTEGER) || lpad((random() * 99999)::INTEGER::TEXT, 5, '0'),
    'user_' || lpad((random() * 1000)::INTEGER::TEXT, 4, '0')
FROM charging_stations,
LATERAL (
    SELECT
        NOW() - (random() * INTERVAL '30 days') AS start_ts
    FROM generate_series(1, 200)
) sub;
