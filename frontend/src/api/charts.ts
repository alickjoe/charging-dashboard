import api from './client';
import type { ChartDataRequest, ChartDataResponse } from '../types';

export async function fetchChartData(
  connectionName: string,
  table: string,
  request: ChartDataRequest
): Promise<ChartDataResponse> {
  const { data } = await api.post<ChartDataResponse>(
    `/connections/${connectionName}/tables/${table}/chart-data`,
    request
  );
  return data;
}
