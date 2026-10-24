import os
import re
import numpy as np
import time
import sys
from PIL import Image

import torch
import torch.nn as nn
import torch.backends.cudnn as cudnn
import torchvision
import torchvision.transforms as transforms
import torch.optim as optim
import torch.nn.functional as tfunc
from torch.utils.data import DataLoader
from torch.optim.lr_scheduler import ReduceLROnPlateau

from sklearn.metrics import roc_auc_score

from DensenetModels import DenseNet121
from DensenetModels import DenseNet169
from DensenetModels import DenseNet201
from DatasetGenerator import DatasetGenerator


#-------------------------------------------------------------------------------- 

CLASS_NAMES = [ 'Atelectasis', 'Cardiomegaly', 'Effusion', 'Infiltration', 'Mass', 'Nodule', 'Pneumonia',
        'Pneumothorax', 'Consolidation', 'Edema', 'Emphysema', 'Fibrosis', 'Pleural_Thickening', 'Hernia']

class ChexnetTrainer ():

    @staticmethod
    def load_checkpoint_weights(model, pathModel, device):
        checkpoint = torch.load(pathModel, map_location=device, weights_only=False)
        state_dict = checkpoint['state_dict']
        is_model_dp = isinstance(model, torch.nn.DataParallel)
        new_state_dict = {}
        for k, v in state_dict.items():
            k_clean = re.sub(r'(denseblock\d+\.denselayer\d+\.(?:norm|conv))\.([12])', r'\1\2', k)
            if is_model_dp:
                if not k_clean.startswith('module.'):
                    k_clean = 'module.' + k_clean
            else:
                if k_clean.startswith('module.'):
                    k_clean = k_clean[7:]
            new_state_dict[k_clean] = v
        model.load_state_dict(new_state_dict)
        return checkpoint

    #---- Train the densenet network 
    @classmethod
    def train (cls, pathDirData, pathFileTrain, pathFileVal, nnArchitecture, nnIsTrained, nnClassCount, trBatchSize, trMaxEpoch, transResize, transCrop, launchTimestamp, checkpoint):

        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        #-------------------- SETTINGS: NETWORK ARCHITECTURE
        if nnArchitecture == 'DENSE-NET-121': model = DenseNet121(nnClassCount, nnIsTrained)
        elif nnArchitecture == 'DENSE-NET-169': model = DenseNet169(nnClassCount, nnIsTrained)
        elif nnArchitecture == 'DENSE-NET-201': model = DenseNet201(nnClassCount, nnIsTrained)
        
        if torch.cuda.is_available():
            model = torch.nn.DataParallel(model).cuda()
        else:
            model = model.to(device)
                
        #-------------------- SETTINGS: DATA TRANSFORMS
        normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        
        transformList = []
        transformList.append(transforms.RandomResizedCrop(transCrop))
        transformList.append(transforms.RandomHorizontalFlip())
        transformList.append(transforms.ToTensor())
        transformList.append(normalize)      
        transformSequence=transforms.Compose(transformList)

        #-------------------- SETTINGS: DATASET BUILDERS
        datasetTrain = DatasetGenerator(pathImageDirectory=pathDirData, pathDatasetFile=pathFileTrain, transform=transformSequence)
        datasetVal =   DatasetGenerator(pathImageDirectory=pathDirData, pathDatasetFile=pathFileVal, transform=transformSequence)
              
        num_workers = 4 if os.name != 'nt' else 0
        dataLoaderTrain = DataLoader(dataset=datasetTrain, batch_size=trBatchSize, shuffle=True,  num_workers=num_workers, pin_memory=torch.cuda.is_available())
        dataLoaderVal = DataLoader(dataset=datasetVal, batch_size=trBatchSize, shuffle=False, num_workers=num_workers, pin_memory=torch.cuda.is_available())
        
        #-------------------- SETTINGS: OPTIMIZER & SCHEDULER
        optimizer = optim.Adam (model.parameters(), lr=0.0001, betas=(0.9, 0.999), eps=1e-08, weight_decay=1e-5)
        scheduler = ReduceLROnPlateau(optimizer, factor = 0.1, patience = 5, mode = 'min')
                
        #-------------------- SETTINGS: LOSS
        loss = torch.nn.BCELoss()
        
        #---- Load checkpoint 
        if checkpoint != None:
            modelCheckpoint = cls.load_checkpoint_weights(model, checkpoint, device)
            if 'optimizer' in modelCheckpoint:
                optimizer.load_state_dict(modelCheckpoint['optimizer'])

        
        #---- TRAIN THE NETWORK
        lossMIN = 100000
        
        for epochID in range (0, trMaxEpoch):
            
            timestampTime = time.strftime("%H%M%S")
            timestampDate = time.strftime("%d%m%Y")
            timestampSTART = timestampDate + '-' + timestampTime
                         
            cls.epochTrain (model, dataLoaderTrain, optimizer, scheduler, trMaxEpoch, nnClassCount, loss, device)
            lossVal, losstensor = cls.epochVal (model, dataLoaderVal, optimizer, scheduler, trMaxEpoch, nnClassCount, loss, device)
            
            timestampTime = time.strftime("%H%M%S")
            timestampDate = time.strftime("%d%m%Y")
            timestampEND = timestampDate + '-' + timestampTime
            
            scheduler.step(losstensor.item() if hasattr(losstensor, 'item') else losstensor)
            
            if lossVal < lossMIN:
                lossMIN = lossVal    
                torch.save({'epoch': epochID + 1, 'state_dict': model.state_dict(), 'best_loss': lossMIN, 'optimizer' : optimizer.state_dict()}, 'm-' + launchTimestamp + '.pth.tar')
                print ('Epoch [' + str(epochID + 1) + '] [save] [' + timestampEND + '] loss= ' + str(lossVal))
            else:
                print ('Epoch [' + str(epochID + 1) + '] [----] [' + timestampEND + '] loss= ' + str(lossVal))
                     
    #-------------------------------------------------------------------------------- 
       
    @staticmethod
    def epochTrain (model, dataLoader, optimizer, scheduler, epochMax, classCount, loss, device):
        
        model.train()
        
        for batchID, (input, target) in enumerate (dataLoader):
                        
            target = target.to(device, non_blocking=True)
            varInput = input.to(device)
            varTarget = target
            varOutput = model(varInput)
            
            lossvalue = loss(varOutput, varTarget)
                       
            optimizer.zero_grad()
            lossvalue.backward()
            optimizer.step()
            
    #-------------------------------------------------------------------------------- 
        
    @staticmethod
    def epochVal (model, dataLoader, optimizer, scheduler, epochMax, classCount, loss, device):
        
        model.eval ()
        
        lossVal = 0
        lossValNorm = 0
        losstensorMean = 0
        
        with torch.no_grad():
            for i, (input, target) in enumerate (dataLoader):
                
                target = target.to(device, non_blocking=True)
                varInput = input.to(device)
                varTarget = target
                varOutput = model(varInput)
                
                losstensor = loss(varOutput, varTarget)
                losstensorMean += losstensor.item()
                lossVal += losstensor.item()
                lossValNorm += 1
            
        outLoss = lossVal / (lossValNorm if lossValNorm > 0 else 1)
        losstensorMean = losstensorMean / (lossValNorm if lossValNorm > 0 else 1)
        
        return outLoss, losstensorMean
               
    #--------------------------------------------------------------------------------     
     
    #---- Computes area under ROC curve 
    @staticmethod
    def computeAUROC (dataGT, dataPRED, classCount):
        
        outAUROC = []
        datanpGT = dataGT.cpu().numpy()
        datanpPRED = dataPRED.cpu().numpy()
        
        for i in range(classCount):
            try:
                outAUROC.append(roc_auc_score(datanpGT[:, i], datanpPRED[:, i]))
            except Exception:
                outAUROC.append(0.0)
            
        return outAUROC
        
    #--------------------------------------------------------------------------------  
    
    #---- Single image disease prediction with Ten-crop inference
    @classmethod
    def predict (cls, pathImageFile, pathModel, nnArchitecture='DENSE-NET-121', nnClassCount=14, transResize=256, transCrop=224):
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        if nnArchitecture == 'DENSE-NET-121': model = DenseNet121(nnClassCount, False)
        elif nnArchitecture == 'DENSE-NET-169': model = DenseNet169(nnClassCount, False)
        elif nnArchitecture == 'DENSE-NET-201': model = DenseNet201(nnClassCount, False)
        
        if torch.cuda.is_available():
            model = torch.nn.DataParallel(model).cuda()
        else:
            model = model.to(device)
            
        cls.load_checkpoint_weights(model, pathModel, device)
        model.eval()
        
        normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        transformList = [
            transforms.Resize(transResize),
            transforms.TenCrop(transCrop),
            transforms.Lambda(lambda crops: torch.stack([transforms.ToTensor()(crop) for crop in crops])),
            transforms.Lambda(lambda crops: torch.stack([normalize(crop) for crop in crops]))
        ]
        transformSequence = transforms.Compose(transformList)
        
        imageData = Image.open(pathImageFile).convert('RGB')
        input_tensor = transformSequence(imageData)
        n_crops, c, h, w = input_tensor.size()
        
        with torch.no_grad():
            input_var = input_tensor.view(-1, c, h, w).to(device)
            out = model(input_var)
            outMean = out.view(1, n_crops, -1).mean(1).squeeze().cpu().numpy()
            
        predictions = {CLASS_NAMES[i]: float(outMean[i]) for i in range(len(CLASS_NAMES))}
        return predictions

    #--------------------------------------------------------------------------------  
    
    #---- Test the trained network 
    @classmethod
    def test (cls, pathDirData, pathFileTest, pathModel, nnArchitecture, nnClassCount, nnIsTrained, trBatchSize, transResize, transCrop, launchTimeStamp):   
        
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f'Using device: {device}')
        
        if torch.cuda.is_available():
            cudnn.benchmark = True
        
        #-------------------- SETTINGS: NETWORK ARCHITECTURE, MODEL LOAD
        if nnArchitecture == 'DENSE-NET-121': model = DenseNet121(nnClassCount, nnIsTrained)
        elif nnArchitecture == 'DENSE-NET-169': model = DenseNet169(nnClassCount, nnIsTrained)
        elif nnArchitecture == 'DENSE-NET-201': model = DenseNet201(nnClassCount, nnIsTrained)
        
        if torch.cuda.is_available():
            model = torch.nn.DataParallel(model).cuda()
        else:
            model = model.to(device)
        
        print(f'Loading model checkpoint: {pathModel}')
        cls.load_checkpoint_weights(model, pathModel, device)
        print('Checkpoint loaded successfully.')

        # Check if dataset files exist
        if not os.path.exists(pathFileTest):
            print(f'Test dataset file {pathFileTest} not found.')
            return

        datasetTest = DatasetGenerator(pathImageDirectory=pathDirData, pathDatasetFile=pathFileTest, transform=None)
        if len(datasetTest.listImagePaths) == 0 or not os.path.exists(datasetTest.listImagePaths[0]):
            print(f'Note: Full NIH dataset images not found in {pathDirData}.')
            print('Running single sample prediction on test/00009285_000.png instead:')
            if os.path.exists('test/00009285_000.png'):
                preds = cls.predict('test/00009285_000.png', pathModel, nnArchitecture, nnClassCount, transResize, transCrop)
                print('-' * 45)
                print(f'{"Pathology":<22} | {"Probability":<12} | {"Percent"}')
                print('-' * 45)
                for name, prob in sorted(preds.items(), key=lambda x: x[1], reverse=True):
                    print(f'{name:<22} | {prob:.4f}       | {prob*100:6.2f}%')
                print('-' * 45)
            return

        #-------------------- SETTINGS: DATA TRANSFORMS, TEN CROPS
        normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        transformList = []
        transformList.append(transforms.Resize(transResize))
        transformList.append(transforms.TenCrop(transCrop))
        transformList.append(transforms.Lambda(lambda crops: torch.stack([transforms.ToTensor()(crop) for crop in crops])))
        transformList.append(transforms.Lambda(lambda crops: torch.stack([normalize(crop) for crop in crops])))
        transformSequence=transforms.Compose(transformList)
        
        datasetTest.transform = transformSequence
        num_workers = 4 if os.name != 'nt' else 0
        dataLoaderTest = DataLoader(dataset=datasetTest, batch_size=trBatchSize, num_workers=num_workers, shuffle=False, pin_memory=torch.cuda.is_available())
        
        outGT = torch.FloatTensor().to(device)
        outPRED = torch.FloatTensor().to(device)
       
        model.eval()
        
        with torch.no_grad():
            for i, (input, target) in enumerate(dataLoaderTest):
                target = target.to(device)
                outGT = torch.cat((outGT, target), 0)
                
                bs, n_crops, c, h, w = input.size()
                input_var = input.view(-1, c, h, w).to(device)
                
                out = model(input_var)
                outMean = out.view(bs, n_crops, -1).mean(1)
                outPRED = torch.cat((outPRED, outMean.data), 0)

        aurocIndividual = cls.computeAUROC(outGT, outPRED, nnClassCount)
        aurocMean = np.array(aurocIndividual).mean()
        
        print ('AUROC mean ', aurocMean)
        for i in range (0, len(aurocIndividual)):
            print (f'{CLASS_NAMES[i]:20s} {aurocIndividual[i]:.4f}')
        
        return
