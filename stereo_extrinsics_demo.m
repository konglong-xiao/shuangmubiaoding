% stereo_extrinsics_demo.m
% 双目相机外参示例：将左相机坐标变换到右相机坐标。
% 所有坐标系均为右手系，点和平移均为 3x1 列向量，长度单位为 mm。
% 约定 x 向右、y 向下、z 向前；旋转矩阵按右手定则构造。
% 输入外参的方向为棋盘坐标系 -> 相机坐标系：
%   P_L = R_L * P_board + t_L
%   P_R = R_R * P_board + t_R
% 因此 P_R = R * P_L + T，其中：
%   R = R_R * R_L.'
%   T = t_R - R * t_L
% 注意：T 是左相机原点在右相机坐标系中的坐标，
% 并非右相机中心在左相机坐标系中的位置（后者为 -R.' * T）。
% 在 MATLAB 中运行 stereo_extrinsics_demo 即可验证两个示例。

tol = 1e-10;  % 点坐标比较的绝对容差，单位 mm

%% 例 1：纯平移，右相机位于左相机右方 100 mm
R_L = eye(3);
R_R = eye(3);
t_L = [0; 0; 500];
t_R = [-100; 0; 500];

R = R_R * R_L.';
T = t_R - R * t_L;

P_L = [250; 0; 500];
P_R = R * P_L + T;
P_R_expected = [150; 0; 500];

fprintf('\n=== 例 1：纯平移 ===\n');
fprintf('左相机 -> 右相机的旋转 R：\n');
disp(R);
fprintf('左相机 -> 右相机的平移 T (mm)：\n');
disp(T);
fprintf('变换前 P_L (mm)：\n');
disp(P_L);
fprintf('变换后 P_R (mm)：\n');
disp(P_R);

assert(norm(P_R - P_R_expected, inf) < tol, ...
    '例 1 失败：右相机中的点应为 [150; 0; 500] mm。');
fprintf('例 1 验证通过。\n');

%% 例 2：带旋转和平移的合成外参
% 左相机：绕 y 轴旋转 +15 度。
angle_L = 15;
R_L = [cosd(angle_L), 0, sind(angle_L); ...
       0,              1, 0; ...
      -sind(angle_L), 0, cosd(angle_L)];
t_L = [30; -20; 500];

% 右相机：先绕 y 轴旋转 -20 度，再绕 z 轴旋转 -10 度。
angle_R_y = -20;
angle_R_z = -10;
Ry = [cosd(angle_R_y), 0, sind(angle_R_y); ...
      0,                1, 0; ...
     -sind(angle_R_y), 0, cosd(angle_R_y)];
Rz = [cosd(angle_R_z), -sind(angle_R_z), 0; ...
      sind(angle_R_z),  cosd(angle_R_z), 0; ...
      0,                0,               1];
R_R = Rz * Ry;
t_R = [-100; 10; 520];

R = R_R * R_L.';
T = t_R - R * t_L;

P_board = [80; 40; 0];  % 棋盘平面上的同一个点，单位 mm

% 路径一：棋盘 -> 右相机。
P_R_direct = R_R * P_board + t_R;

% 路径二：棋盘 -> 左相机 -> 右相机。
P_L = R_L * P_board + t_L;
P_R_via_left = R * P_L + T;
error_mm = norm(P_R_direct - P_R_via_left, inf);

fprintf('\n=== 例 2：带旋转和平移 ===\n');
fprintf('左相机 -> 右相机的旋转 R：\n');
disp(R);
fprintf('左相机 -> 右相机的平移 T (mm)：\n');
disp(T);
fprintf('棋盘点 P_board (mm)：\n');
disp(P_board);
fprintf('变换前 P_L (mm)：\n');
disp(P_L);
fprintf('路径一：棋盘 -> 右相机，P_R_direct (mm)：\n');
disp(P_R_direct);
fprintf('路径二：棋盘 -> 左相机 -> 右相机，P_R_via_left (mm)：\n');
disp(P_R_via_left);
fprintf('两条路径的最大坐标误差：%.3e mm\n', error_mm);

assert(error_mm < tol, ...
    '例 2 失败：两条路径计算出的右相机坐标不一致。');
fprintf('例 2 验证通过。\n');
