import { useQuery } from "@tanstack/react-query";
import { Link } from "@/router";
import { Layout } from "@/components/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckSquare,
  Clock,
  Play,
  AlertCircle,
  TrendingUp,
  Activity,
  Plus,
  Eye,
  ArrowRight,
} from "lucide-react";
import {
  apiClient,
  TaskDetailsDto,
  ProcessInstanceDTO,
  UserStatsDto,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, getTaskStatusColors } from "@/lib/utils";
import { ApiErrorToast } from "@/components/ApiErrorToast";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Fetch user statistics
  const {
    data: userStats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ["user-stats"],
    queryFn: async () => {
      const response = await apiClient.getUserStats();
      if (response.data) {
        return response.data;
      } else {
        toast(
          ApiErrorToast({
            error: response.error,
            defaultMessage: "Failed to fetch user statistics",
          }),
        );
        throw new Error("Failed to fetch user statistics");
      }
    },
  });

  // Extract data from userStats since it contains everything we need
  const recentTasks = userStats?.recentTasks?.slice(0, 5) || [];
  const processInstances =
    userStats?.processActivity?.recentlyStartedProcesses?.slice(0, 5) || [];

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "Completed";
      case "CLAIMED":
        return "Claimed";
      case "AVAILABLE":
        return "Available";
      case "FAILED":
        return "Failed";
      default:
        return status;
    }
  };

  const isLoading = statsLoading;

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Welcome back, {user?.username}!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening with your tasks and processes
          </p>
        </div>

        {isLoading ? (
          <div className="text-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-2">Loading dashboard...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Active Tasks
                  </CardTitle>
                  <CheckSquare className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {userStats?.quickStats.activeTasks || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Currently assigned to you
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Completed Tasks
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {userStats?.quickStats.completedTasks || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {userStats?.tasksByStatus.COMPLETED || 0} total completed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Running Processes
                  </CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {userStats?.quickStats.runningProcesses || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {userStats?.processActivity.activeProcessCount || 0} active
                    processes
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Available Tasks
                  </CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {userStats?.quickStats.availableTasks || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ready to be claimed
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Overdue Tasks Alert */}
            {userStats?.overdueTasks && userStats.overdueTasks.length > 0 && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="flex items-center text-destructive">
                    <AlertCircle className="mr-2 h-5 w-5" />
                    Overdue Tasks ({userStats.overdueTasks.length})
                  </CardTitle>
                  <CardDescription>
                    You have tasks that are overdue and need immediate attention
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {userStats.overdueTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between p-2 rounded border border-destructive/20 bg-destructive/5"
                      >
                        <div className="flex-1">
                          <Link
                            to={`/tasks/${task.id}`}
                            className="text-sm font-medium hover:text-primary"
                          >
                            {task.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {task.daysOverdue} days overdue
                          </p>
                        </div>
                        <Badge variant="destructive">Overdue</Badge>
                      </div>
                    ))}
                    {userStats.overdueTasks.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center">
                        And {userStats.overdueTasks.length - 3} more overdue
                        tasks...
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Recent Tasks */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Recent Tasks</CardTitle>
                      <CardDescription>
                        Your latest task activity
                      </CardDescription>
                    </div>
                    <Link to="/tasks">
                      <Button variant="outline" size="sm">
                        <Eye className="mr-2 h-4 w-4" />
                        View All
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  {recentTasks && recentTasks.length > 0 ? (
                    <div className="space-y-3">
                      {recentTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex-1">
                            <Link
                              to={`/tasks/${task.id}`}
                              className="text-sm font-medium hover:text-primary"
                            >
                              {task.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {task.processDefinitionName ||
                                task.processDefinitionId}
                            </p>
                          </div>
                          <Badge className={getTaskStatusColors(task.status)}>
                            {getStatusLabel(task.status)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <CheckSquare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No recent tasks
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Process Activity */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Process Activity</CardTitle>
                      <CardDescription>
                        Active process instances
                        {userStats?.processActivity.completionRate && (
                          <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            {Math.round(
                              userStats.processActivity.completionRate * 100,
                            )}
                            % completion rate
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Link to="/processes">
                      <Button variant="outline" size="sm">
                        <Eye className="mr-2 h-4 w-4" />
                        View All
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  {processInstances && processInstances.length > 0 ? (
                    <div className="space-y-3">
                      {processInstances.map((instance) => (
                        <div
                          key={instance.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {instance.processDefinitionName ||
                                instance.processDefinitionId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Started {formatDistanceToNow(instance.startDate)}{" "}
                              ago
                              {instance.currentActivityId &&
                                ` • ${instance.currentActivityId}`}
                            </p>
                          </div>
                          <Badge
                            variant={
                              instance.currentActivityId
                                ? "secondary"
                                : "default"
                            }
                          >
                            {instance.currentActivityId
                              ? "Active"
                              : "Completed"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <Play className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No active processes
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common tasks and shortcuts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <Link to="/tasks">
                    <Button variant="outline" className="flex items-center">
                      <CheckSquare className="mr-2 h-4 w-4" />
                      View All Tasks
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/processes">
                    <Button variant="outline" className="flex items-center">
                      <Play className="mr-2 h-4 w-4" />
                      Browse Processes
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/processes/upload">
                    <Button variant="outline" className="flex items-center">
                      <Plus className="mr-2 h-4 w-4" />
                      Deploy Process
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
