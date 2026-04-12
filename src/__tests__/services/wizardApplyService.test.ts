import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@microsoft/microsoft-graph-client';
import {
    createDirectoryRoleAssignment,
    createGroupAssignment
} from '@/services/wizardApplyService';

// Mock Graph Client
const mockClient = {
    api: vi.fn().mockReturnThis(),
    post: vi.fn(),
    header: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
} as unknown as Client;

describe('wizardApplyService', () => {
    beforeEach(() => {
        vi.clear AllMocks();
    });

    describe('createDirectoryRoleAssignment', () => {
        it('should create eligible assignment successfully', async () => {
            // Mock successful response
            mockClient.post = vi.fn().mockResolvedValue({
                id: 'test-assignment-id',
                status: 'Provisioned'
            });

            const result = await createDirectoryRoleAssignment(
                mockClient,
                'role-123',
                'user-456',
                'eligible',
                {
                    startDate: null,
                    endDate: null,
                    justification: 'Test assignment'
                }
            );

            expect(result).toEqual({
                id: 'test-assignment-id',
                status: 'Provisioned'
            });

            expect(mockClient.api).toHaveBeenCalledWith('/roleManagement/directory/roleEligibilityScheduleRequests');
        });

        it('should create active assignment successfully', async () => {
            mockClient.post = vi.fn().mockResolvedValue({
                id: 'test-active-id',
                status: 'Provisioned'
            });

            const result = await createDirectoryRoleAssignment(
                mockClient,
                'role-789',
                'user-101',
                'active',
                {
                    startDate: null,
                    endDate: null,
                    justification: 'Active assignment test'
                }
            );

            expect(result).toEqual({
                id: 'test-active-id',
                status: 'Provisioned'
            });

            expect(mockClient.api).toHaveBeenCalledWith('/roleManagement/directory/roleAssignmentScheduleRequests');
        });

        it('should handle RoleAssignmentAlreadyExists error', async () => {
            const error = new Error('Request failed with status code 409');
            (error as any).code = 'Request_BadRequest';
            (error as any).statusCode = 409;
            (error as any).body = JSON.stringify({
                error: {
                    code: 'RoleAssignmentExists',
                    message: 'The role assignment already exists.'
                }
            });

            mockClient.post = vi.fn().mockRejectedValue(error);

            await expect(
                createDirectoryRoleAssignment(
                    mockClient,
                    'role-123',
                    'user-456',
                    'eligible',
                    {}
                )
            ).rejects.toThrow('Request failed with status code 409');
        });

        it('should handle permission errors', async () => {
            const error = new Error('Insufficient privileges');
            (error as any).code = 'Authorization_RequestDenied';
            (error as any).statusCode = 403;

            mockClient.post = vi.fn().mockRejectedValue(error);

            await expect(
                createDirectoryRoleAssignment(
                    mockClient,
                    'role-123',
                    'user-456',
                    'eligible',
                    {}
                )
            ).rejects.toThrow('Insufficient privileges');
        });
    });

    describe('createGroupAssignment', () => {
        it('should create group member assignment', async () => {
            mockClient.post = vi.fn().mockResolvedValue({
                id: 'group-assignment-id',
                status: 'Provisioned'
            });

            const result = await createGroupAssignment(
                mockClient,
                'group-123',
                'user-456',
                'member',
                'eligible',
                {
                    startDate: null,
                    endDate: null,
                    justification: 'Group member test'
                }
            );

            expect(result).toEqual({
                id: 'group-assignment-id',
                status: 'Provisioned'
            });
        });

        it('should create group owner assignment', async () => {
            mockClient.post = vi.fn().mockResolvedValue({
                id: 'group-owner-id',
                status: 'Provisioned'
            });

            const result = await createGroupAssignment(
                mockClient,
                'group-789',
                'user-101',
                'owner',
                'active',
                {
                    startDate: null,
                    endDate: null
                }
            );

            expect(result).toEqual({
                id: 'group-owner-id',
                status: 'Provisioned'
            });
        });

        it('should handle network errors gracefully', async () => {
            const networkError = new Error('Network request failed');
            mockClient.post = vi.fn().mockRejectedValue(networkError);

            await expect(
                createGroupAssignment(
                    mockClient,
                    'group-123',
                    'user-456',
                    'member',
                    'eligible',
                    {}
                )
            ).rejects.toThrow('Network request failed');
        });
    });

    describe('Edge Cases', () => {
        it('should handle dates with time zones correctly', async () => {
            mockClient.post = vi.fn().mockResolvedValue({ id: 'test-id' });

            const startDate = new Date('2024-01-15T10:00:00Z');
            const endDate = new Date('2024-12-31T23:59:59Z');

            await createDirectoryRoleAssignment(
                mockClient,
                'role-123',
                'user-456',
                'eligible',
                {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            );

            expect(mockClient.post).toHaveBeenCalled();
        });

        it('should handle optional justification correctly', async () => {
            mockClient.post = vi.fn().mockResolvedValue({ id: 'test-id' });

            // Without justification
            await createDirectoryRoleAssignment(
                mockClient,
                'role-123',
                'user-456',
                'eligible',
                {
                    startDate: null,
                    endDate: null
                }
            );

            expect(mockClient.post).toHaveBeenCalled();
        });
    });
});
