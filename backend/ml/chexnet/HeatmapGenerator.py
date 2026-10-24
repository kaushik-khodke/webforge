import os
import re
import numpy as np
import time
import sys
from PIL import Image

import cv2

import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.backends.cudnn as cudnn
import torchvision
import torchvision.transforms as transforms

from DensenetModels import DenseNet121
from DensenetModels import DenseNet169
from DensenetModels import DenseNet201

#-------------------------------------------------------------------------------- 
#---- Class to generate heatmaps (CAM)

class HeatmapGenerator ():
    
    #---- Initialize heatmap generator
    #---- pathModel - path to the trained densenet model
    #---- nnArchitecture - architecture name DENSE-NET-121, DENSE-NET-169, DENSE-NET-201
    #---- nnClassCount - class count, 14 for chestxray-14
 
    def __init__ (self, pathModel, nnArchitecture='DENSE-NET-121', nnClassCount=14, transCrop=224):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
       
        #---- Initialize the network
        if nnArchitecture == 'DENSE-NET-121': model = DenseNet121(nnClassCount, False)
        elif nnArchitecture == 'DENSE-NET-169': model = DenseNet169(nnClassCount, False)
        elif nnArchitecture == 'DENSE-NET-201': model = DenseNet201(nnClassCount, False)

        modelCheckpoint = torch.load(pathModel, map_location=self.device, weights_only=False)
        state_dict = modelCheckpoint['state_dict']
        new_state_dict = {}
        for k, v in state_dict.items():
            if k.startswith('module.'):
                k = k[7:]
            k = re.sub(r'(denseblock\d+\.denselayer\d+\.(?:norm|conv))\.([12])', r'\1\2', k)
            new_state_dict[k] = v

        model.load_state_dict(new_state_dict)
        model = model.to(self.device)
        model.eval()

        self.model = model
        self.features = model.densenet121.features
        self.classifier_weights = model.densenet121.classifier[0].weight.data
        
        #---- Initialize the image transform - resize + normalize
        normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        transformList = []
        transformList.append(transforms.Resize((transCrop, transCrop)))
        transformList.append(transforms.ToTensor())
        transformList.append(normalize)      
        
        self.transformSequence = transforms.Compose(transformList)
    
    #--------------------------------------------------------------------------------
     
    def generate (self, pathImageFile, pathOutputFile, transCrop=224, targetClassIndex=None):
        
        #---- Load image, transform, convert 
        imageData = Image.open(pathImageFile).convert('RGB')
        imageData = self.transformSequence(imageData)
        imageData = imageData.unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            features = self.features(imageData)
            features = F.relu(features, inplace=True)
            
            if targetClassIndex is None:
                # Use class with highest linear logit / weight activation
                pooled = F.adaptive_avg_pool2d(features, (1, 1)).view(features.size(0), -1)
                logits = torch.mm(pooled, self.classifier_weights.t())
                targetClassIndex = int(torch.argmax(logits, dim=1).item())
            
            w = self.classifier_weights[targetClassIndex].unsqueeze(0).unsqueeze(-1).unsqueeze(-1)
            cam = torch.sum(w * features, dim=1).squeeze().cpu().numpy()
            cam = np.maximum(cam, 0)
            cam = cam / (np.max(cam) + 1e-8)
        
        #---- Blend original and heatmap 
        imgOriginal = cv2.imread(pathImageFile, 1)
        orig_h, orig_w, _ = imgOriginal.shape
        cam_resized = cv2.resize(cam, (orig_w, orig_h))
        heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
              
        img = np.uint8(imgOriginal * 0.6 + heatmap * 0.4)
            
        cv2.imwrite(pathOutputFile, img)
        print(f'Heatmap CAM generated and saved to: {pathOutputFile}')
        return targetClassIndex
        
#-------------------------------------------------------------------------------- 

if __name__ == '__main__':
    pathInputImage = 'test/00009285_000.png'
    pathOutputImage = 'test/heatmap.png'
    pathModel = 'models/m-25012018-123527.pth.tar'

    nnArchitecture = 'DENSE-NET-121'
    nnClassCount = 14
    transCrop = 224

    h = HeatmapGenerator(pathModel, nnArchitecture, nnClassCount, transCrop)
    h.generate(pathInputImage, pathOutputImage, transCrop)